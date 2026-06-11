mod models;
mod db;
mod algorithms;
mod alerts;
mod handlers;

use actix_web::{web, App, HttpServer, middleware};
use actix_cors::Cors;
use dotenvy::dotenv;
use std::env;
use tracing::{info, level_filters::LevelFilter};
use tracing_subscriber::EnvFilter;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::builder()
                .with_default_directive(LevelFilter::INFO.into())
                .from_env_lossy(),
        )
        .init();

    info!("Starting Lacquer Monitor Backend...");

    let pool = db::create_pool().expect("Failed to create database pool");

    if let Err(e) = db::init_db(&pool).await {
        tracing::error!("Database initialization failed: {}", e);
    }

    let alert_config = alerts::AlertConfig::default();
    let alert_pool = pool.clone();
    tokio::spawn(async move {
        alerts::run_alert_checker(alert_pool, alert_config).await;
    });

    let host = env::var("SERVER_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port: u16 = env::var("SERVER_PORT")
        .unwrap_or_else(|_| "8080".to_string())
        .parse()
        .unwrap_or(8080);

    info!("Server starting on {}:{}", host, port);

    HttpServer::new(move || {
        let cors = Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header()
            .max_age(3600);

        App::new()
            .app_data(web::Data::new(pool.clone()))
            .wrap(cors)
            .wrap(middleware::Logger::default())
            .service(
                web::scope("/api")
                    .route("/statistics", web::get().to(handlers::get_statistics))
                    .route("/lacquer-wares", web::get().to(handlers::get_lacquer_wares))
                    .route("/lacquer-wares/{id}", web::get().to(handlers::get_lacquer_ware_by_id))
                    .route("/sensors", web::get().to(handlers::get_sensors))
                    .route("/moisture/latest", web::get().to(handlers::get_latest_moisture))
                    .route("/strain/latest", web::get().to(handlers::get_latest_strain))
                    .route("/lacquer-wares/{id}/moisture", web::get().to(handlers::get_moisture_data))
                    .route("/lacquer-wares/{id}/strain", web::get().to(handlers::get_strain_data))
                    .route("/predict/moisture", web::post().to(handlers::predict_moisture_loss))
                    .route("/predict/penetration", web::post().to(handlers::predict_penetration))
                    .route("/reinforcement-agents", web::get().to(handlers::get_reinforcement_agents))
                    .route("/alerts", web::get().to(handlers::get_alerts))
                    .route("/nb-iot/data", web::post().to(handlers::receive_nb_iot_data))
            )
    })
    .bind((host.as_str(), port))?
    .run()
    .await
}
