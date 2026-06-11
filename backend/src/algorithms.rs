use std::f64::consts::PI;

pub struct FickianDiffusionModel {
    pub diffusion_coefficient: f64,
    pub thickness: f64,
}

impl FickianDiffusionModel {
    pub fn new(diffusion_coefficient: Option<f64>, thickness: Option<f64>) -> Self {
        Self {
            diffusion_coefficient: diffusion_coefficient.unwrap_or(1e-9),
            thickness: thickness.unwrap_or(0.01),
        }
    }

    pub fn predict_moisture_loss(
        &self,
        initial_moisture: f64,
        target_moisture: f64,
        time_hours: f64,
        num_points: usize,
    ) -> (Vec<f64>, Vec<f64>, f64) {
        let mut time_points = Vec::with_capacity(num_points);
        let mut moisture_values = Vec::with_capacity(num_points);

        let d = self.diffusion_coefficient;
        let l = self.thickness;
        let c0 = initial_moisture;
        let ce = target_moisture;

        for i in 0..num_points {
            let t_hours = (time_hours * i as f64) / (num_points - 1).max(1) as f64;
            let t_seconds = t_hours * 3600.0;

            let mt = self.calculate_mt(c0, ce, d, l, t_seconds);

            time_points.push(t_hours);
            moisture_values.push(mt);
        }

        let estimated_time = self.estimate_dehydration_time(c0, ce, d, l);

        (time_points, moisture_values, estimated_time)
    }

    fn calculate_mt(&self, c0: f64, ce: f64, d: f64, l: f64, t: f64) -> f64 {
        if t <= 0.0 {
            return c0;
        }

        let x = l / 2.0;
        let mut sum = 0.0;

        for n in 0..50 {
            let n_f = n as f64;
            let term = ((-1.0_f64).powf(n_f) / (2.0 * n_f + 1.0))
                * ((PI * (2.0 * n_f + 1.0) * x) / (2.0 * l)).cos()
                * (-d * PI * PI * (2.0 * n_f + 1.0).powi(2) * t / (4.0 * l * l)).exp();
            sum += term;
        }

        let mt = ce + (c0 - ce) * (4.0 / PI) * sum;
        mt.max(ce)
    }

    fn estimate_dehydration_time(&self, c0: f64, ce: f64, d: f64, l: f64) -> f64 {
        let target_ratio = 0.95;
        let time_seconds = (l * l) / (PI * PI * d) * ((PI / 4.0) * (c0 - ce) / (target_ratio * (c0 - ce))).ln().abs();
        time_seconds / 3600.0
    }

    pub fn moisture_at_depth(&self, depth: f64, time_hours: f64, initial_moisture: f64, surface_moisture: f64) -> f64 {
        let t = time_hours * 3600.0;
        let d = self.diffusion_coefficient;
        let l = self.thickness;

        let mut sum = 0.0;
        for n in 0..50 {
            let n_f = n as f64;
            let term = ((-1.0_f64).powf(n_f) / (2.0 * n_f + 1.0))
                * ((PI * (2.0 * n_f + 1.0) * depth) / (2.0 * l)).cos()
                * (-d * PI * PI * (2.0 * n_f + 1.0).powi(2) * t / (4.0 * l * l)).exp();
            sum += term;
        }

        surface_moisture + (initial_moisture - surface_moisture) * (4.0 / PI) * sum
    }
}

pub struct DarcyLawModel {
    pub permeability: f64,
    pub viscosity: f64,
    pub porosity: f64,
}

impl DarcyLawModel {
    pub fn new(viscosity: f64, permeability: Option<f64>) -> Self {
        Self {
            permeability: permeability.unwrap_or(1e-14),
            viscosity,
            porosity: 0.4,
        }
    }

    pub fn predict_penetration(
        &self,
        time_hours: f64,
        pressure_diff: f64,
        sample_length: f64,
        num_points: usize,
    ) -> (Vec<f64>, Vec<f64>, f64) {
        let mut time_points = Vec::with_capacity(num_points);
        let mut depth_values = Vec::with_capacity(num_points);

        let k = self.permeability;
        let mu = self.viscosity;
        let phi = self.porosity;
        let delta_p = pressure_diff;

        for i in 0..num_points {
            let t_hours = (time_hours * i as f64) / (num_points - 1).max(1) as f64;
            let t_seconds = t_hours * 3600.0;

            let depth = ((2.0 * k * delta_p * t_seconds) / (mu * phi)).sqrt();
            let depth_mm = depth * 1000.0;

            time_points.push(t_hours);
            depth_values.push(depth_mm.min(sample_length * 1000.0));
        }

        let final_depth = ((2.0 * k * delta_p * time_hours * 3600.0) / (mu * phi)).sqrt() * 1000.0;

        (time_points, depth_values, final_depth.min(sample_length * 1000.0))
    }

    pub fn flow_rate(&self, pressure_diff: f64, area: f64, length: f64) -> f64 {
        let k = self.permeability;
        let mu = self.viscosity;
        (k * area * pressure_diff) / (mu * length)
    }

    pub fn penetration_velocity(&self, pressure_diff: f64, current_depth: f64) -> f64 {
        if current_depth <= 0.0 {
            return f64::INFINITY;
        }
        let k = self.permeability;
        let mu = self.viscosity;
        let phi = self.porosity;
        (k * pressure_diff) / (mu * phi * current_depth)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fickian_diffusion() {
        let model = FickianDiffusionModel::new(Some(1e-9), Some(0.01));
        let (times, moistures, est_time) = model.predict_moisture_loss(80.0, 12.0, 720.0, 100);

        assert_eq!(times.len(), 100);
        assert_eq!(moistures.len(), 100);
        assert!(moistures[0] > moistures[moistures.len() - 1]);
        assert!(est_time > 0.0);
    }

    #[test]
    fn test_darcy_law() {
        let model = DarcyLawModel::new(0.056, Some(1e-14));
        let (times, depths, final_depth) = model.predict_penetration(48.0, 101325.0, 0.05, 50);

        assert_eq!(times.len(), 50);
        assert_eq!(depths.len(), 50);
        assert!(depths[0] < depths[depths.len() - 1]);
        assert!(final_depth > 0.0);
    }
}
