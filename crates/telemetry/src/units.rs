//! Distances are stored in km everywhere and converted only for display.

pub const KM_PER_MILE: f64 = 1.609_344;

pub fn km_to_miles(km: f64) -> f64 {
    km / KM_PER_MILE
}

pub fn ms_to_kmh(speed_ms: f64) -> f64 {
    speed_ms * 3.6
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_km_to_miles() {
        assert!((km_to_miles(1_609.344) - 1_000.0).abs() < 1e-9);
    }

    #[test]
    fn converts_speed() {
        assert!((ms_to_kmh(25.0) - 90.0).abs() < 1e-9);
    }
}
