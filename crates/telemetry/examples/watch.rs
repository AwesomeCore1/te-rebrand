//! Prints what the tracker sees while ETS2 or ATS runs. Windows only.
//!
//! Use it to check the live source against the real game, without the app:
//!
//! ```text
//! cargo run -p te-telemetry --example watch
//! cargo run -p te-telemetry --example watch -- --record drive.jsonl
//! ```
//!
//! `--record` also writes every frame to a file, one JSON object per line.
//! That is the format `replay::parse` reads, so a recorded drive can become
//! a test fixture.

#[cfg(not(windows))]
fn main() {
    eprintln!("Game telemetry is Windows-only. Use the replay fixtures on this platform.");
}

#[cfg(windows)]
fn main() -> std::io::Result<()> {
    use std::io::Write;
    use std::time::{Duration, Instant};

    use te_telemetry::source::{FrameSource, SharedMemorySource};
    use te_telemetry::{replay, units, JobEvent, JobTracker};

    let mut args = std::env::args().skip(1);
    let mut record = match (args.next().as_deref(), args.next()) {
        (None, _) => None,
        (Some("--record"), Some(path)) => {
            println!("Recording frames to {path}");
            Some(std::io::BufWriter::new(std::fs::File::create(path)?))
        }
        _ => {
            eprintln!("usage: watch [--record <file.jsonl>]");
            std::process::exit(2);
        }
    };

    let mut source = SharedMemorySource::new();
    let mut tracker = JobTracker::new();
    let mut state = String::new();
    let mut last_line: Option<Instant> = None;
    println!("Watching for ETS2 or ATS. Ctrl+C to stop.");

    loop {
        std::thread::sleep(Duration::from_millis(250));
        let Some(frame) = source.next_frame() else {
            let now = source
                .problem()
                .unwrap_or("Waiting for the game.")
                .to_owned();
            if now != state {
                println!("{now}");
                state = now;
            }
            continue;
        };
        if let Some(file) = record.as_mut() {
            writeln!(file, "{}", replay::to_line(&frame))?;
            file.flush()?;
        }

        let now = format!(
            "{:?}, {}",
            frame.game,
            if frame.multiplayer {
                "TruckersMP"
            } else {
                "singleplayer"
            }
        );
        if now != state {
            println!("Game found: {now}");
            state = now;
        }

        // Fines, tolls, ferries and trains, as the game reports them. Only
        // the ones during a job are kept; they are listed again when it ends.
        for event in &frame.player_events {
            println!("GAME EVENT    {event:?}");
        }

        for event in tracker.push(&frame) {
            match event {
                JobEvent::Started { job, .. } => println!(
                    "JOB STARTED   {} ({}) to {} ({}), {}, {:.0} kg, {:.0} km planned, income {}",
                    job.source_city,
                    job.source_company,
                    job.destination_city,
                    job.destination_company,
                    job.cargo,
                    job.cargo_mass_kg,
                    job.planned_distance_km,
                    job.income,
                ),
                JobEvent::Finished(job) => {
                    println!(
                        "JOB FINISHED  {:?}: {} to {}, {:.1} km driven (odometer {:.1} to {:.1}), top speed {:.0} km/h, cargo damage {:.1} %, {} events",
                        job.status,
                        job.job.source_city,
                        job.job.destination_city,
                        job.driven_km,
                        job.odometer_start_km,
                        job.odometer_end_km,
                        job.max_speed_kmh,
                        job.cargo_damage * 100.0,
                        job.events.len(),
                    );
                    for event in &job.events {
                        println!(
                            "              {:>6.0} s in: {:?}",
                            event.at_ms.saturating_sub(job.started_at_ms) as f64 / 1000.0,
                            event.event,
                        );
                    }
                }
            }
        }

        if last_line.is_none_or(|t| t.elapsed() >= Duration::from_secs(5)) {
            last_line = Some(Instant::now());
            println!(
                "{:>9.1} km  {:>5.0} km/h  x {:>9.1}  z {:>9.1}  {}  {}",
                frame.odometer_km,
                units::ms_to_kmh(frame.speed_ms),
                frame.position.0,
                frame.position.1,
                if frame.paused { "paused " } else { "driving" },
                match tracker.current_job() {
                    Some(job) => format!("job: {} to {}", job.source_city, job.destination_city),
                    None => "no job".to_owned(),
                },
            );
        }
    }
}
