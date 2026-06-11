use deadpool_postgres::{Config, Pool, PoolConfig, Runtime};
use tokio_postgres::NoTls;
use std::env;

pub type DbPool = Pool;

pub fn create_pool() -> Result<DbPool, Box<dyn std::error::Error>> {
    let database_url = env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:5432/lacquer_monitor".to_string());

    let mut cfg = Config::new();
    cfg.url = Some(database_url);

    let max_pool_size: usize = env::var("DB_POOL_SIZE")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(16);

    let wait_timeout_seconds: u64 = env::var("DB_POOL_WAIT_TIMEOUT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(30);

    cfg.pool = Some(PoolConfig {
        max_size: max_pool_size,
        timeouts: deadpool_postgres::Timeouts {
            wait: Some(std::time::Duration::from_secs(wait_timeout_seconds)),
            create: Some(std::time::Duration::from_secs(30)),
            recycle: Some(std::time::Duration::from_secs(30)),
        },
        ..Default::default()
    });

    let pool = cfg.create_pool(Some(Runtime::Tokio1), NoTls)?;
    tracing::info!(
        "Database pool created: max_size={}, wait_timeout={}s",
        max_pool_size, wait_timeout_seconds
    );
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
