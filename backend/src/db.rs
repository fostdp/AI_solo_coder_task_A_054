use deadpool_postgres::{Config, Pool, Runtime};
use tokio_postgres::NoTls;
use std::env;

pub type DbPool = Pool;

pub fn create_pool() -> Result<DbPool, Box<dyn std::error::Error>> {
    let database_url = env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:5432/lacquer_monitor".to_string());
    
    let mut cfg = Config::new();
    cfg.url = Some(database_url);
    
    let pool = cfg.create_pool(Some(Runtime::Tokio1), NoTls)?;
    Ok(pool)
}

pub async fn init_db(pool: &DbPool) -> Result<(), Box<dyn std::error::Error>> {
    let client = pool.get().await?;
    
    let _rows = client.query(
        "SELECT 1 AS connection_test",
        &[]
    ).await?;
    
    tracing::info!("Database connection established successfully");
    
    Ok(())
}
