use crate::db::DbPool;
use crate::models::*;
use crate::algorithms::{FickianDiffusionModel, DarcyLawModel};
use crate::alerts::AlertSystem;
use actix_web::{web, HttpResponse, Responder};
use chrono::{DateTime, Utc, Duration};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct PaginationParams {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct TimeRangeParams {
    pub start_time: Option<DateTime<Utc>>,
    pub end_time: Option<DateTime<Utc>>,
}

pub async fn get_lacquer_wares(
    pool: web::Data<DbPool>,
    query: web::Query<PaginationParams>,
) -> impl Responder {
    let client = match pool.get().await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().json(
            ApiResponse::<Vec<LacquerWare>> {
                success: false,
                message: format!("Database error: {}", e),
                data: None,
            }
        ),
    };

    let limit = query.limit.unwrap_or(50);
    let offset = query.offset.unwrap_or(0);

    let rows = match client.query(
        r#"
        SELECT id, name, artifact_code, description, material, excavation_site, dynasty,
               initial_moisture, current_moisture, target_moisture, status, created_at, updated_at
        FROM lacquer_ware
        ORDER BY id
        LIMIT $1 OFFSET $2
        "#,
        &[&limit, &offset],
    ).await {
        Ok(r) => r,
        Err(e) => return HttpResponse::InternalServerError().json(
            ApiResponse::<Vec<LacquerWare>> {
                success: false,
                message: format!("Query error: {}", e),
                data: None,
            }
        ),
    };

    let mut lacquer_wares = Vec::new();
    for row in rows {
        lacquer_wares.push(LacquerWare {
            id: row.get("id"),
            name: row.get("name"),
            artifact_code: row.get("artifact_code"),
            description: row.get("description"),
            material: row.get("material"),
            excavation_site: row.get("excavation_site"),
            dynasty: row.get("dynasty"),
            initial_moisture: row.get("initial_moisture"),
            current_moisture: row.get("current_moisture"),
            target_moisture: row.get("target_moisture"),
            status: row.get("status"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        });
    }

    HttpResponse::Ok().json(ApiResponse {
        success: true,
        message: "Success".to_string(),
        data: Some(lacquer_wares),
    })
}

pub async fn get_lacquer_ware_by_id(
    pool: web::Data<DbPool>,
    id: web::Path<i32>,
) -> impl Responder {
    let client = match pool.get().await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().json(
            ApiResponse::<LacquerWare> {
                success: false,
                message: format!("Database error: {}", e),
                data: None,
            }
        ),
    };

    let row = match client.query_opt(
        r#"
        SELECT id, name, artifact_code, description, material, excavation_site, dynasty,
               initial_moisture, current_moisture, target_moisture, status, created_at, updated_at
        FROM lacquer_ware
        WHERE id = $1
        "#,
        &[&id.into_inner()],
    ).await {
        Ok(r) => r,
        Err(e) => return HttpResponse::InternalServerError().json(
            ApiResponse::<LacquerWare> {
                success: false,
                message: format!("Query error: {}", e),
                data: None,
            }
        ),
    };

    match row {
        Some(row) => {
            let ware = LacquerWare {
                id: row.get("id"),
                name: row.get("name"),
                artifact_code: row.get("artifact_code"),
                description: row.get("description"),
                material: row.get("material"),
                excavation_site: row.get("excavation_site"),
                dynasty: row.get("dynasty"),
                initial_moisture: row.get("initial_moisture"),
                current_moisture: row.get("current_moisture"),
                target_moisture: row.get("target_moisture"),
                status: row.get("status"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
            };
            HttpResponse::Ok().json(ApiResponse {
                success: true,
                message: "Success".to_string(),
                data: Some(ware),
            })
        }
        None => HttpResponse::NotFound().json(ApiResponse::<LacquerWare> {
            success: false,
            message: "Lacquer ware not found".to_string(),
            data: None,
        }),
    }
}

pub async fn get_sensors(
    pool: web::Data<DbPool>,
    query: web::Query<PaginationParams>,
) -> impl Responder {
    let client = match pool.get().await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().json(
            ApiResponse::<Vec<Sensor>> {
                success: false,
                message: format!("Database error: {}", e),
                data: None,
            }
        ),
    };

    let limit = query.limit.unwrap_or(100);
    let offset = query.offset.unwrap_or(0);

    let rows = match client.query(
        r#"
        SELECT id, device_id, sensor_type, lacquer_ware_id, location_on_xyz,
               installation_date, status, nb_iot_imsi, created_at
        FROM sensors
        ORDER BY id
        LIMIT $1 OFFSET $2
        "#,
        &[&limit, &offset],
    ).await {
        Ok(r) => r,
        Err(e) => return HttpResponse::InternalServerError().json(
            ApiResponse::<Vec<Sensor>> {
                success: false,
                message: format!("Query error: {}", e),
                data: None,
            }
        ),
    };

    let mut sensors = Vec::new();
    for row in rows {
        sensors.push(Sensor {
            id: row.get("id"),
            device_id: row.get("device_id"),
            sensor_type: row.get("sensor_type"),
            lacquer_ware_id: row.get("lacquer_ware_id"),
            location_on_xyz: row.get("location_on_xyz"),
            installation_date: row.get("installation_date"),
            status: row.get("status"),
            nb_iot_imsi: row.get("nb_iot_imsi"),
            created_at: row.get("created_at"),
        });
    }

    HttpResponse::Ok().json(ApiResponse {
        success: true,
        message: "Success".to_string(),
        data: Some(sensors),
    })
}

pub async fn get_moisture_data(
    pool: web::Data<DbPool>,
    lacquer_id: web::Path<i32>,
    query: web::Query<TimeRangeParams>,
) -> impl Responder {
    let client = match pool.get().await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().json(
            ApiResponse::<Vec<MoistureData>> {
                success: false,
                message: format!("Database error: {}", e),
                data: None,
            }
        ),
    };

    let end_time = query.end_time.unwrap_or_else(Utc::now);
    let start_time = query.start_time.unwrap_or_else(|| end_time - Duration::hours(24));

    let rows = match client.query(
        r#"
        SELECT time, sensor_id, lacquer_ware_id, moisture_content, temperature,
               raw_value, battery_level, signal_strength
        FROM moisture_data
        WHERE lacquer_ware_id = $1 AND time BETWEEN $2 AND $3
        ORDER BY time DESC
        LIMIT 1000
        "#,
        &[&lacquer_id.into_inner(), &start_time, &end_time],
    ).await {
        Ok(r) => r,
        Err(e) => return HttpResponse::InternalServerError().json(
            ApiResponse::<Vec<MoistureData>> {
                success: false,
                message: format!("Query error: {}", e),
                data: None,
            }
        ),
    };

    let mut data = Vec::new();
    for row in rows {
        data.push(MoistureData {
            time: row.get("time"),
            sensor_id: row.get("sensor_id"),
            lacquer_ware_id: row.get("lacquer_ware_id"),
            moisture_content: row.get("moisture_content"),
            temperature: row.get("temperature"),
            raw_value: row.get("raw_value"),
            battery_level: row.get("battery_level"),
            signal_strength: row.get("signal_strength"),
        });
    }

    HttpResponse::Ok().json(ApiResponse {
        success: true,
        message: "Success".to_string(),
        data: Some(data),
    })
}

pub async fn get_strain_data(
    pool: web::Data<DbPool>,
    lacquer_id: web::Path<i32>,
    query: web::Query<TimeRangeParams>,
) -> impl Responder {
    let client = match pool.get().await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().json(
            ApiResponse::<Vec<StrainData>> {
                success: false,
                message: format!("Database error: {}", e),
                data: None,
            }
        ),
    };

    let end_time = query.end_time.unwrap_or_else(Utc::now);
    let start_time = query.start_time.unwrap_or_else(|| end_time - Duration::hours(24));

    let rows = match client.query(
        r#"
        SELECT time, sensor_id, lacquer_ware_id, strain_value, temperature,
               raw_value, battery_level, signal_strength
        FROM strain_data
        WHERE lacquer_ware_id = $1 AND time BETWEEN $2 AND $3
        ORDER BY time DESC
        LIMIT 1000
        "#,
        &[&lacquer_id.into_inner(), &start_time, &end_time],
    ).await {
        Ok(r) => r,
        Err(e) => return HttpResponse::InternalServerError().json(
            ApiResponse::<Vec<StrainData>> {
                success: false,
                message: format!("Query error: {}", e),
                data: None,
            }
        ),
    };

    let mut data = Vec::new();
    for row in rows {
        data.push(StrainData {
            time: row.get("time"),
            sensor_id: row.get("sensor_id"),
            lacquer_ware_id: row.get("lacquer_ware_id"),
            strain_value: row.get("strain_value"),
            temperature: row.get("temperature"),
            raw_value: row.get("raw_value"),
            battery_level: row.get("battery_level"),
            signal_strength: row.get("signal_strength"),
        });
    }

    HttpResponse::Ok().json(ApiResponse {
        success: true,
        message: "Success".to_string(),
        data: Some(data),
    })
}

pub async fn get_latest_moisture(
    pool: web::Data<DbPool>,
) -> impl Responder {
    let client = match pool.get().await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().json(
            ApiResponse::<Vec<MoistureData>> {
                success: false,
                message: format!("Database error: {}", e),
                data: None,
            }
        ),
    };

    let rows = match client.query(
        r#"
        SELECT DISTINCT ON (sensor_id)
            time, sensor_id, lacquer_ware_id, moisture_content, temperature,
            raw_value, battery_level, signal_strength
        FROM moisture_data
        ORDER BY sensor_id, time DESC
        "#,
        &[],
    ).await {
        Ok(r) => r,
        Err(e) => return HttpResponse::InternalServerError().json(
            ApiResponse::<Vec<MoistureData>> {
                success: false,
                message: format!("Query error: {}", e),
                data: None,
            }
        ),
    };

    let mut data = Vec::new();
    for row in rows {
        data.push(MoistureData {
            time: row.get("time"),
            sensor_id: row.get("sensor_id"),
            lacquer_ware_id: row.get("lacquer_ware_id"),
            moisture_content: row.get("moisture_content"),
            temperature: row.get("temperature"),
            raw_value: row.get("raw_value"),
            battery_level: row.get("battery_level"),
            signal_strength: row.get("signal_strength"),
        });
    }

    HttpResponse::Ok().json(ApiResponse {
        success: true,
        message: "Success".to_string(),
        data: Some(data),
    })
}

pub async fn get_latest_strain(
    pool: web::Data<DbPool>,
) -> impl Responder {
    let client = match pool.get().await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().json(
            ApiResponse::<Vec<StrainData>> {
                success: false,
                message: format!("Database error: {}", e),
                data: None,
            }
        ),
    };

    let rows = match client.query(
        r#"
        SELECT DISTINCT ON (sensor_id)
            time, sensor_id, lacquer_ware_id, strain_value, temperature,
            raw_value, battery_level, signal_strength
        FROM strain_data
        ORDER BY sensor_id, time DESC
        "#,
        &[],
    ).await {
        Ok(r) => r,
        Err(e) => return HttpResponse::InternalServerError().json(
            ApiResponse::<Vec<StrainData>> {
                success: false,
                message: format!("Query error: {}", e),
                data: None,
            }
        ),
    };

    let mut data = Vec::new();
    for row in rows {
        data.push(StrainData {
            time: row.get("time"),
            sensor_id: row.get("sensor_id"),
            lacquer_ware_id: row.get("lacquer_ware_id"),
            strain_value: row.get("strain_value"),
            temperature: row.get("temperature"),
            raw_value: row.get("raw_value"),
            battery_level: row.get("battery_level"),
            signal_strength: row.get("signal_strength"),
        });
    }

    HttpResponse::Ok().json(ApiResponse {
        success: true,
        message: "Success".to_string(),
        data: Some(data),
    })
}

pub async fn predict_moisture_loss(
    body: web::Json<MoisturePredictionRequest>,
) -> impl Responder {
    let model = FickianDiffusionModel::new(
        body.diffusion_coefficient,
        body.thickness,
    );

    let (time_points, moisture_values, estimated_time) = model.predict_moisture_loss(
        body.initial_moisture,
        body.target_moisture,
        body.time_hours,
        100,
    );

    let result = MoisturePredictionResult {
        time_points,
        moisture_values,
        diffusion_coefficient: model.diffusion_coefficient,
        estimated_dehydration_time_hours: estimated_time,
    };

    HttpResponse::Ok().json(ApiResponse {
        success: true,
        message: "Success".to_string(),
        data: Some(result),
    })
}

pub async fn predict_penetration(
    body: web::Json<PenetrationPredictionRequest>,
) -> impl Responder {
    let model = DarcyLawModel::new(
        body.viscosity,
        body.permeability,
    );

    let pressure_diff = body.pressure_diff.unwrap_or(101325.0);

    let (time_points, depth_values, final_depth) = model.predict_penetration(
        body.time_hours,
        pressure_diff,
        0.05,
        100,
    );

    let result = PenetrationPredictionResult {
        time_points,
        depth_values,
        permeability: model.permeability,
        final_depth,
    };

    HttpResponse::Ok().json(ApiResponse {
        success: true,
        message: "Success".to_string(),
        data: Some(result),
    })
}

pub async fn get_reinforcement_agents(
    pool: web::Data<DbPool>,
) -> impl Responder {
    let client = match pool.get().await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().json(
            ApiResponse::<Vec<ReinforcementAgent>> {
                success: false,
                message: format!("Database error: {}", e),
                data: None,
            }
        ),
    };

    let rows = match client.query(
        r#"
        SELECT id, name, agent_type, concentration, viscosity, description, created_at
        FROM reinforcement_agents
        ORDER BY id
        "#,
        &[],
    ).await {
        Ok(r) => r,
        Err(e) => return HttpResponse::InternalServerError().json(
            ApiResponse::<Vec<ReinforcementAgent>> {
                success: false,
                message: format!("Query error: {}", e),
                data: None,
            }
        ),
    };

    let mut agents = Vec::new();
    for row in rows {
        agents.push(ReinforcementAgent {
            id: row.get("id"),
            name: row.get("name"),
            agent_type: row.get("agent_type"),
            concentration: row.get("concentration"),
            viscosity: row.get("viscosity"),
            description: row.get("description"),
            created_at: row.get("created_at"),
        });
    }

    HttpResponse::Ok().json(ApiResponse {
        success: true,
        message: "Success".to_string(),
        data: Some(agents),
    })
}

pub async fn get_alerts(
    pool: web::Data<DbPool>,
    query: web::Query<PaginationParams>,
) -> impl Responder {
    let alert_system = AlertSystem::new(pool.get_ref().clone(), crate::alerts::AlertConfig::default());
    let limit = query.limit.unwrap_or(50);

    match alert_system.get_recent_alerts(limit).await {
        Ok(alerts) => HttpResponse::Ok().json(ApiResponse {
            success: true,
            message: "Success".to_string(),
            data: Some(alerts),
        }),
        Err(e) => HttpResponse::InternalServerError().json(
            ApiResponse::<Vec<Alert>> {
                success: false,
                message: format!("Error: {}", e),
                data: None,
            }
        ),
    }
}

pub async fn receive_nb_iot_data(
    pool: web::Data<DbPool>,
    body: web::Json<NbIotDataPacket>,
) -> impl Responder {
    let client = match pool.get().await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().json(
            ApiResponse::<String> {
                success: false,
                message: format!("Database error: {}", e),
                data: None,
            }
        ),
    };

    let sensor_row = match client.query_opt(
        "SELECT id, lacquer_ware_id, sensor_type FROM sensors WHERE device_id = $1",
        &[&body.device_id],
    ).await {
        Ok(r) => r,
        Err(e) => return HttpResponse::InternalServerError().json(
            ApiResponse::<String> {
                success: false,
                message: format!("Query error: {}", e),
                data: None,
            }
        ),
    };

    let (sensor_id, lacquer_ware_id, sensor_type) = match sensor_row {
        Some(row) => (
            row.get::<_, i32>("id"),
            row.get::<_, Option<i32>>("lacquer_ware_id"),
            row.get::<_, String>("sensor_type"),
        ),
        None => {
            return HttpResponse::NotFound().json(ApiResponse::<String> {
                success: false,
                message: "Sensor not found".to_string(),
                data: None,
            });
        }
    };

    let lacquer_id = match lacquer_ware_id {
        Some(id) => id,
        None => {
            return HttpResponse::BadRequest().json(ApiResponse::<String> {
                success: false,
                message: "Sensor not assigned to any lacquer ware".to_string(),
                data: None,
            });
        }
    };

    let result = if sensor_type == "moisture" {
        client.execute(
            r#"
            INSERT INTO moisture_data (time, sensor_id, lacquer_ware_id, moisture_content, temperature, battery_level, signal_strength)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            "#,
            &[
                &body.timestamp,
                &sensor_id,
                &lacquer_id,
                &body.value,
                &body.temperature,
                &body.battery_level,
                &body.signal_strength,
            ],
        ).await
    } else if sensor_type == "strain" {
        client.execute(
            r#"
            INSERT INTO strain_data (time, sensor_id, lacquer_ware_id, strain_value, temperature, battery_level, signal_strength)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            "#,
            &[
                &body.timestamp,
                &sensor_id,
                &lacquer_id,
                &body.value,
                &body.temperature,
                &body.battery_level,
                &body.signal_strength,
            ],
        ).await
    } else {
        return HttpResponse::BadRequest().json(ApiResponse::<String> {
            success: false,
            message: "Unknown sensor type".to_string(),
            data: None,
        });
    };

    match result {
        Ok(_) => HttpResponse::Ok().json(ApiResponse {
            success: true,
            message: "Data received successfully".to_string(),
            data: Some("OK".to_string()),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::<String> {
            success: false,
            message: format!("Insert error: {}", e),
            data: None,
        }),
    }
}

pub async fn get_statistics(
    pool: web::Data<DbPool>,
) -> impl Responder {
    let client = match pool.get().await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().json(
            ApiResponse::<serde_json::Value> {
                success: false,
                message: format!("Database error: {}", e),
                data: None,
            }
        ),
    };

    let mut stats = serde_json::Map::new();

    if let Ok(row) = client.query_one("SELECT COUNT(*) as count FROM lacquer_ware", &[]).await {
        stats.insert("total_lacquer_wares".to_string(), serde_json::json!(row.get::<_, i64>("count")));
    }

    if let Ok(row) = client.query_one("SELECT COUNT(*) as count FROM sensors", &[]).await {
        stats.insert("total_sensors".to_string(), serde_json::json!(row.get::<_, i64>("count")));
    }

    if let Ok(row) = client.query_one("SELECT COUNT(*) as count FROM sensors WHERE sensor_type = 'moisture'", &[]).await {
        stats.insert("moisture_sensors".to_string(), serde_json::json!(row.get::<_, i64>("count")));
    }

    if let Ok(row) = client.query_one("SELECT COUNT(*) as count FROM sensors WHERE sensor_type = 'strain'", &[]).await {
        stats.insert("strain_sensors".to_string(), serde_json::json!(row.get::<_, i64>("count")));
    }

    if let Ok(row) = client.query_one("SELECT AVG(moisture_content) as avg FROM latest_moisture_view", &[]).await {
        let avg: Option<f64> = row.get("avg");
        stats.insert("avg_moisture".to_string(), serde_json::json!(avg.unwrap_or(0.0)));
    }

    if let Ok(row) = client.query_one("SELECT AVG(strain_value) as avg FROM latest_strain_view", &[]).await {
        let avg: Option<f64> = row.get("avg");
        stats.insert("avg_strain".to_string(), serde_json::json!(avg.unwrap_or(0.0)));
    }

    if let Ok(row) = client.query_one("SELECT COUNT(*) as count FROM alerts WHERE is_acknowledged = false", &[]).await {
        stats.insert("active_alerts".to_string(), serde_json::json!(row.get::<_, i64>("count")));
    }

    HttpResponse::Ok().json(ApiResponse {
        success: true,
        message: "Success".to_string(),
        data: Some(serde_json::Value::Object(stats)),
    })
}
