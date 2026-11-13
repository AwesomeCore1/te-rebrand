//! The RenCloud scs-sdk-plugin's memory map, decoded into [`Frame`]s.
//!
//! The plugin (https://github.com/RenCloud/scs-sdk-plugin) runs inside the
//! game and copies SDK telemetry into a memory map shaped like a C struct.
//! The struct changes between plugin revisions, so this module is pinned to
//! one: **revision 12, release V.1.12.1**. The offsets below come from
//! `scs-telemetry/inc/scs-telemetry-common.hpp` at that tag and were checked
//! by compiling the header with MSVC and printing `offsetof` for each field.
//! When moving to a newer plugin, redo that check and update
//! [`PLUGIN_REVISION`] in the same change.
//!
//! Decoding is plain byte reading, so it builds and is tested on every
//! platform. Only opening the map is Windows-only (see [`crate::source`]).

use crate::{Frame, Game, GameplayEvent, JobInfo, PlayerEvent};

/// Name of the memory map the plugin creates.
pub const MAPPING_NAME: &str = "Local\\SCSTelemetry";

/// The only plugin revision this module can read.
pub const PLUGIN_REVISION: u32 = 12;

/// How many bytes of the map [`Decoder::decode`] needs: everything up to the
/// end of the event flags. The map itself is 32 KiB; the rest (substances,
/// trailers) is not read.
pub const SNAPSHOT_LEN: usize = 4400;

/// Byte offsets into `scsTelemetryMap_t`, plugin revision 12.
mod offset {
    pub const SDK_ACTIVE: usize = 0; // bool
    pub const PAUSED: usize = 4; // bool
    pub const PLUGIN_REVISION: usize = 40; // u32
    pub const GAME: usize = 52; // u32: 1 = ETS2, 2 = ATS
    pub const PLANNED_DISTANCE_KM: usize = 100; // u32
    pub const CARGO_MASS_KG: usize = 748; // f32
    pub const SPEED_MS: usize = 948; // f32
    pub const ODOMETER_KM: usize = 1056; // f32
    pub const DELIVERED_CARGO_DAMAGE: usize = 1456; // f32, set by the delivered event
    pub const CARGO_DAMAGE: usize = 1468; // f32
    pub const POSITION_X: usize = 2200; // f64
    pub const POSITION_Z: usize = 2216; // f64
    pub const CARGO: usize = 2620; // char[64]
    pub const DESTINATION_CITY: usize = 2748; // char[64]
    pub const DESTINATION_COMPANY: usize = 2876; // char[64]
    pub const SOURCE_CITY: usize = 3004; // char[64]
    pub const SOURCE_COMPANY: usize = 3132; // char[64]
    pub const FINE_OFFENCE: usize = 3436; // char[32], set by the fined event
    pub const FERRY_SOURCE: usize = 3468; // char[64], set by the ferry event
    pub const FERRY_TARGET: usize = 3532; // char[64]
    pub const TRAIN_SOURCE: usize = 3724; // char[64], set by the train event
    pub const TRAIN_TARGET: usize = 3788; // char[64]
    pub const INCOME: usize = 4000; // u64
    pub const FINE_AMOUNT: usize = 4216; // i64, set by the fined event
    pub const TOLL_AMOUNT: usize = 4224; // i64, set by the tollgate event
    pub const FERRY_AMOUNT: usize = 4232; // i64
    pub const TRAIN_AMOUNT: usize = 4240; // i64
    pub const ON_JOB: usize = 4300; // bool
    pub const JOB_CANCELLED: usize = 4302; // bool, flips on every cancelled job
    pub const JOB_DELIVERED: usize = 4303; // bool, flips on every delivered job
    pub const FINED: usize = 4304; // bool, flips on every fine
    pub const TOLLGATE: usize = 4305; // bool, flips on every toll paid
    pub const FERRY: usize = 4306; // bool, flips on every ferry taken
    pub const TRAIN: usize = 4307; // bool, flips on every train taken
}

const STRING_LEN: usize = 64;
const OFFENCE_LEN: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ScsError {
    #[error(
        "The telemetry plugin in the game is revision {found}, but Tacho reads revision {PLUGIN_REVISION}."
    )]
    UnsupportedRevision { found: u32 },
    #[error("The telemetry plugin's memory map is smaller than expected.")]
    TooShort,
}

/// Turns successive snapshots of the memory map into frames.
///
/// It keeps a little state between snapshots, for three reasons:
///
/// - The plugin signals "job delivered" and "job cancelled" by flipping a
///   flag, so an event is a change from the previous snapshot. Fines, tolls,
///   ferries and trains are signalled the same way.
/// - For those four the plugin flips the flag first and writes the details
///   (amount, offence, names) after it, so the snapshot that catches the flip
///   can still hold the details of the previous fine. They are read one
///   snapshot later, when the plugin is long done, and reported then.
/// - A job's details are written while the game is paused (in the job list
///   or while a save loads), when the odometer still shows whatever it showed
///   before. A new job is therefore held back until the game has been
///   unpaused, with the same job details, for two snapshots in a row. That
///   also covers a snapshot taken while the plugin was half way through
///   writing the details.
#[derive(Debug, Default)]
pub struct Decoder {
    /// The flip flags as last read. `None` until the first snapshot after
    /// the game appears, so flags left over from earlier fire nothing.
    flags: Option<Flags>,
    /// Job details in the previous snapshot.
    candidate: Option<JobInfo>,
    /// The candidate has been reported in a frame.
    announced: bool,
    prev_unpaused: bool,
    /// Cargo damage last seen during the job. The plugin clears the live
    /// value in the same step as it flips an end-of-job flag.
    last_cargo_damage: f64,
    /// Whose flag flipped in the previous snapshot: reported in this one.
    due: [bool; PLAYER_FLAGS.len()],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Flags {
    delivered: bool,
    cancelled: bool,
    /// In the order of [`PLAYER_FLAGS`].
    player: [bool; PLAYER_FLAGS.len()],
}

/// The flags behind [`PlayerEvent`]s: fine, toll, ferry, train. Events of one
/// snapshot are reported in this order.
const PLAYER_FLAGS: [usize; 4] = [
    offset::FINED,
    offset::TOLLGATE,
    offset::FERRY,
    offset::TRAIN,
];

impl Decoder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Forget everything. Call when the game is gone: the plugin zeroes the
    /// map on the next start, which must not look like a flag flip.
    pub fn reset(&mut self) {
        *self = Self::default();
    }

    /// Decodes one snapshot of the map (at least [`SNAPSHOT_LEN`] bytes).
    ///
    /// Returns `Ok(None)` when the plugin says no game is running. The map
    /// does not say whether the game is on TruckersMP, so `multiplayer` is
    /// always `false` here; the source fills it in.
    pub fn decode(&mut self, map: &[u8], t_ms: u64) -> Result<Option<Frame>, ScsError> {
        if map.len() < SNAPSHOT_LEN {
            self.reset();
            return Err(ScsError::TooShort);
        }
        if !read_bool(map, offset::SDK_ACTIVE) {
            self.reset();
            return Ok(None);
        }
        let revision = read_u32(map, offset::PLUGIN_REVISION);
        if revision != PLUGIN_REVISION {
            self.reset();
            return Err(ScsError::UnsupportedRevision { found: revision });
        }
        let game = match read_u32(map, offset::GAME) {
            1 => Game::Ets2,
            2 => Game::Ats,
            _ => {
                self.reset();
                return Ok(None);
            }
        };

        let paused = read_bool(map, offset::PAUSED);
        let flags = Flags {
            delivered: read_bool(map, offset::JOB_DELIVERED),
            cancelled: read_bool(map, offset::JOB_CANCELLED),
            player: PLAYER_FLAGS.map(|flag| read_bool(map, flag)),
        };
        let prev = self.flags.replace(flags);
        let gameplay_event = match prev {
            Some(prev) if prev.delivered != flags.delivered => Some(GameplayEvent::JobDelivered),
            Some(prev) if prev.cancelled != flags.cancelled => Some(GameplayEvent::JobCancelled),
            _ => None,
        };
        let flipped = match prev {
            Some(prev) => std::array::from_fn(|i| prev.player[i] != flags.player[i]),
            None => [false; PLAYER_FLAGS.len()],
        };
        let player_events = read_player_events(map, std::mem::replace(&mut self.due, flipped));

        let live_damage = unit_interval(read_f32(map, offset::CARGO_DAMAGE));
        let cargo_damage = match gameplay_event {
            // The game reports the final damage with the delivery itself.
            Some(GameplayEvent::JobDelivered) => {
                unit_interval(read_f32(map, offset::DELIVERED_CARGO_DAMAGE))
            }
            Some(GameplayEvent::JobCancelled) => self.last_cargo_damage,
            None => live_damage,
        };

        let job = self.stable_job(read_job(map), paused);
        if job.is_some() {
            self.last_cargo_damage = live_damage;
        } else if gameplay_event.is_some() {
            self.last_cargo_damage = 0.0;
        }

        Ok(Some(Frame {
            t_ms,
            game,
            paused,
            odometer_km: finite(read_f32(map, offset::ODOMETER_KM)).max(0.0),
            speed_ms: finite(read_f32(map, offset::SPEED_MS)),
            cargo_damage,
            position: (
                finite_f64(read_f64(map, offset::POSITION_X)),
                finite_f64(read_f64(map, offset::POSITION_Z)),
            ),
            job,
            multiplayer: false,
            gameplay_event,
            player_events,
        }))
    }

    /// The job to report in this frame: `current` once it has held still
    /// with the game unpaused (see the type's docs), then for as long as it
    /// stays the same job.
    fn stable_job(&mut self, current: Option<JobInfo>, paused: bool) -> Option<JobInfo> {
        let same = current.is_some() && current == self.candidate;
        self.announced = same && (self.announced || (self.prev_unpaused && !paused));
        self.prev_unpaused = !paused;
        self.candidate = current;
        if self.announced {
            self.candidate.clone()
        } else {
            None
        }
    }
}

/// The job in the map, if the plugin says one is active and its details are
/// filled in. The API requires both cities and the cargo.
fn read_job(map: &[u8]) -> Option<JobInfo> {
    if !read_bool(map, offset::ON_JOB) {
        return None;
    }
    let job = JobInfo {
        source_city: read_string(map, offset::SOURCE_CITY, STRING_LEN),
        destination_city: read_string(map, offset::DESTINATION_CITY, STRING_LEN),
        source_company: read_string(map, offset::SOURCE_COMPANY, STRING_LEN),
        destination_company: read_string(map, offset::DESTINATION_COMPANY, STRING_LEN),
        cargo: read_string(map, offset::CARGO, STRING_LEN),
        cargo_mass_kg: finite(read_f32(map, offset::CARGO_MASS_KG)).max(0.0),
        planned_distance_km: f64::from(read_u32(map, offset::PLANNED_DISTANCE_KM)),
        income: i64::try_from(read_u64(map, offset::INCOME)).unwrap_or(i64::MAX),
    };
    let complete =
        !job.source_city.is_empty() && !job.destination_city.is_empty() && !job.cargo.is_empty();
    complete.then_some(job)
}

/// The events that are `due` (in the order of [`PLAYER_FLAGS`]), from the
/// details the plugin wrote for the last event of each kind.
fn read_player_events(map: &[u8], due: [bool; PLAYER_FLAGS.len()]) -> Vec<PlayerEvent> {
    let [fine, toll, ferry, train] = due;
    let mut events = Vec::new();
    if fine {
        events.push(PlayerEvent::Fine {
            offence: read_string(map, offset::FINE_OFFENCE, OFFENCE_LEN),
            amount: read_i64(map, offset::FINE_AMOUNT),
        });
    }
    if toll {
        events.push(PlayerEvent::Toll {
            amount: read_i64(map, offset::TOLL_AMOUNT),
        });
    }
    if ferry {
        events.push(PlayerEvent::Ferry {
            source: read_string(map, offset::FERRY_SOURCE, STRING_LEN),
            target: read_string(map, offset::FERRY_TARGET, STRING_LEN),
            amount: read_i64(map, offset::FERRY_AMOUNT),
        });
    }
    if train {
        events.push(PlayerEvent::Train {
            source: read_string(map, offset::TRAIN_SOURCE, STRING_LEN),
            target: read_string(map, offset::TRAIN_TARGET, STRING_LEN),
            amount: read_i64(map, offset::TRAIN_AMOUNT),
        });
    }
    events
}

fn bytes<const N: usize>(map: &[u8], at: usize) -> [u8; N] {
    map[at..at + N]
        .try_into()
        .expect("the slice is N bytes long")
}

fn read_bool(map: &[u8], at: usize) -> bool {
    map[at] != 0
}

fn read_u32(map: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(bytes(map, at))
}

fn read_u64(map: &[u8], at: usize) -> u64 {
    u64::from_le_bytes(bytes(map, at))
}

fn read_i64(map: &[u8], at: usize) -> i64 {
    i64::from_le_bytes(bytes(map, at))
}

fn read_f32(map: &[u8], at: usize) -> f32 {
    f32::from_le_bytes(bytes(map, at))
}

fn read_f64(map: &[u8], at: usize) -> f64 {
    f64::from_le_bytes(bytes(map, at))
}

/// A fixed UTF-8 field of `field_len` bytes, ending at the first NUL (or not
/// at all, when the text fills the field).
fn read_string(map: &[u8], at: usize, field_len: usize) -> String {
    let field = &map[at..at + field_len];
    let len = field.iter().position(|&b| b == 0).unwrap_or(field_len);
    String::from_utf8_lossy(&field[..len]).trim().to_owned()
}

fn finite(v: f32) -> f64 {
    if v.is_finite() {
        f64::from(v)
    } else {
        0.0
    }
}

fn finite_f64(v: f64) -> f64 {
    if v.is_finite() {
        v
    } else {
        0.0
    }
}

fn unit_interval(v: f32) -> f64 {
    finite(v).clamp(0.0, 1.0)
}

/// A hand-built memory map, for tests here and in [`crate::source`].
#[cfg(test)]
pub(crate) mod testing {
    use super::{offset, OFFENCE_LEN, PLUGIN_REVISION, SNAPSHOT_LEN, STRING_LEN};

    #[derive(Clone)]
    pub(crate) struct FakeMap(pub Vec<u8>);

    impl FakeMap {
        /// ETS2 running and unpaused, parked at 50,210 km, no job.
        pub fn running() -> Self {
            let mut map = Self(vec![0; SNAPSHOT_LEN]);
            map.0[offset::SDK_ACTIVE] = 1;
            map.put(offset::PLUGIN_REVISION, &PLUGIN_REVISION.to_le_bytes());
            map.put(offset::GAME, &1u32.to_le_bytes());
            map.odometer(50_210.0);
            map
        }

        fn put(&mut self, at: usize, bytes: &[u8]) {
            self.0[at..at + bytes.len()].copy_from_slice(bytes);
        }

        fn text(&mut self, at: usize, text: &str) {
            self.text_in(at, STRING_LEN, text);
        }

        /// Like the plugin's `strncpy`: the text, then NULs to the end of the field.
        fn text_in(&mut self, at: usize, field_len: usize, text: &str) {
            assert!(text.len() <= field_len, "{text:?} does not fit the field");
            self.0[at..at + field_len].fill(0);
            self.put(at, text.as_bytes());
        }

        pub fn revision(&mut self, revision: u32) {
            self.put(offset::PLUGIN_REVISION, &revision.to_le_bytes());
        }

        pub fn game(&mut self, id: u32) {
            self.put(offset::GAME, &id.to_le_bytes());
        }

        pub fn sdk_active(&mut self, active: bool) {
            self.0[offset::SDK_ACTIVE] = u8::from(active);
        }

        pub fn paused(&mut self, paused: bool) {
            self.0[offset::PAUSED] = u8::from(paused);
        }

        pub fn odometer(&mut self, km: f32) {
            self.put(offset::ODOMETER_KM, &km.to_le_bytes());
        }

        pub fn speed(&mut self, ms: f32) {
            self.put(offset::SPEED_MS, &ms.to_le_bytes());
        }

        pub fn position(&mut self, x: f64, z: f64) {
            self.put(offset::POSITION_X, &x.to_le_bytes());
            self.put(offset::POSITION_Z, &z.to_le_bytes());
        }

        pub fn cargo_damage(&mut self, damage: f32) {
            self.put(offset::CARGO_DAMAGE, &damage.to_le_bytes());
        }

        pub fn source_city(&mut self, city: &str) {
            self.text(offset::SOURCE_CITY, city);
        }

        pub fn destination_city(&mut self, city: &str) {
            self.text(offset::DESTINATION_CITY, city);
        }

        /// What the plugin writes when a job is taken or a save with a job loads.
        pub fn take_job(&mut self) {
            self.source_city("Hamburg");
            self.destination_city("Lyon");
            self.text(offset::SOURCE_COMPANY, "Krone Logistics");
            self.text(offset::DESTINATION_COMPANY, "TREE-ET");
            self.text(offset::CARGO, "Electronics");
            self.put(offset::CARGO_MASS_KG, &18_400f32.to_le_bytes());
            self.put(offset::PLANNED_DISTANCE_KM, &1_196u32.to_le_bytes());
            self.put(offset::INCOME, &52_400u64.to_le_bytes());
            self.0[offset::ON_JOB] = 1;
        }

        /// What the plugin does when a job ends: clear it and flip a flag.
        fn end_job(&mut self, flag: usize) {
            for at in [
                offset::SOURCE_CITY,
                offset::DESTINATION_CITY,
                offset::SOURCE_COMPANY,
                offset::DESTINATION_COMPANY,
                offset::CARGO,
            ] {
                self.put(at, &[0; STRING_LEN]);
            }
            self.put(offset::CARGO_MASS_KG, &0f32.to_le_bytes());
            self.put(offset::PLANNED_DISTANCE_KM, &0u32.to_le_bytes());
            self.put(offset::INCOME, &0u64.to_le_bytes());
            self.cargo_damage(0.0);
            self.0[offset::ON_JOB] = 0;
            self.0[flag] ^= 1;
        }

        pub fn deliver(&mut self, final_damage: f32) {
            self.put(offset::DELIVERED_CARGO_DAMAGE, &final_damage.to_le_bytes());
            self.end_job(offset::JOB_DELIVERED);
        }

        pub fn cancel(&mut self) {
            self.end_job(offset::JOB_CANCELLED);
        }

        /// The first thing the plugin does on a fine: flip the flag. The
        /// details still say whatever the fine before this one wrote.
        pub fn fine_flag(&mut self) {
            self.0[offset::FINED] ^= 1;
        }

        /// The second thing: write what the fine was for and how much.
        pub fn fine_details(&mut self, offence: &str, amount: i64) {
            self.text_in(offset::FINE_OFFENCE, OFFENCE_LEN, offence);
            self.put(offset::FINE_AMOUNT, &amount.to_le_bytes());
        }

        pub fn fine(&mut self, offence: &str, amount: i64) {
            self.fine_flag();
            self.fine_details(offence, amount);
        }

        pub fn toll(&mut self, amount: i64) {
            self.0[offset::TOLLGATE] ^= 1;
            self.put(offset::TOLL_AMOUNT, &amount.to_le_bytes());
        }

        pub fn ferry(&mut self, source: &str, target: &str, amount: i64) {
            self.0[offset::FERRY] ^= 1;
            self.put(offset::FERRY_AMOUNT, &amount.to_le_bytes());
            self.text(offset::FERRY_SOURCE, source);
            self.text(offset::FERRY_TARGET, target);
        }

        pub fn train(&mut self, source: &str, target: &str, amount: i64) {
            self.0[offset::TRAIN] ^= 1;
            self.put(offset::TRAIN_AMOUNT, &amount.to_le_bytes());
            self.text(offset::TRAIN_SOURCE, source);
            self.text(offset::TRAIN_TARGET, target);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::testing::FakeMap;
    use super::*;
    use crate::tracker::{JobStatus, TimedEvent};
    use crate::{JobEvent, JobTracker};

    /// Decodes each map in turn, 250 ms apart, like the app's polling loop.
    struct Run {
        decoder: Decoder,
        t_ms: u64,
    }

    impl Run {
        fn new() -> Self {
            Self {
                decoder: Decoder::new(),
                t_ms: 0,
            }
        }

        fn frame(&mut self, map: &FakeMap) -> Frame {
            self.t_ms += 250;
            self.decoder
                .decode(&map.0, self.t_ms)
                .expect("a supported map")
                .expect("a running game")
        }
    }

    #[test]
    fn decodes_a_parked_truck() {
        let mut map = FakeMap::running();
        map.speed(-1.5);
        map.position(1200.5, -340.25);
        let frame = Run::new().frame(&map);

        assert_eq!(frame.game, Game::Ets2);
        assert_eq!(frame.t_ms, 250);
        assert!(!frame.paused);
        assert_eq!(frame.odometer_km, 50_210.0);
        assert_eq!(frame.speed_ms, -1.5);
        assert_eq!(frame.position, (1200.5, -340.25));
        assert_eq!(frame.job, None);
        assert_eq!(frame.gameplay_event, None);
        assert_eq!(frame.player_events, []);
    }

    #[test]
    fn reports_ats() {
        let mut map = FakeMap::running();
        map.game(2);
        assert_eq!(Run::new().frame(&map).game, Game::Ats);
    }

    #[test]
    fn no_frame_when_the_game_is_not_running() {
        let mut decoder = Decoder::new();
        let mut map = FakeMap::running();
        map.sdk_active(false);
        assert_eq!(decoder.decode(&map.0, 0), Ok(None));

        // The plugin is loaded but could not tell which game it is in.
        let mut map = FakeMap::running();
        map.game(0);
        assert_eq!(decoder.decode(&map.0, 0), Ok(None));
    }

    #[test]
    fn refuses_other_plugin_revisions() {
        let mut map = FakeMap::running();
        map.revision(11);
        assert_eq!(
            Decoder::new().decode(&map.0, 0),
            Err(ScsError::UnsupportedRevision { found: 11 })
        );
    }

    #[test]
    fn refuses_a_map_that_is_too_short() {
        let map = FakeMap::running();
        assert_eq!(
            Decoder::new().decode(&map.0[..SNAPSHOT_LEN - 1], 0),
            Err(ScsError::TooShort)
        );
    }

    #[test]
    fn a_drive_becomes_one_delivered_job() {
        let mut run = Run::new();
        let mut tracker = JobTracker::new();
        let mut events = Vec::new();
        let mut map = FakeMap::running();

        // In the job list: the game is paused while the job is taken.
        map.paused(true);
        events.extend(tracker.push(&run.frame(&map)));
        map.take_job();
        let frame = run.frame(&map);
        assert_eq!(frame.job, None, "held back while paused");
        events.extend(tracker.push(&frame));

        // Back in the truck. The second unpaused snapshot reports the job.
        map.paused(false);
        assert_eq!(run.frame(&map).job, None);
        let frame = run.frame(&map);
        assert_eq!(
            frame.job.as_ref().map(|j| j.destination_city.as_str()),
            Some("Lyon")
        );
        events.extend(tracker.push(&frame));

        map.odometer(50_800.0);
        map.speed(25.0);
        map.cargo_damage(0.008);
        events.extend(tracker.push(&run.frame(&map)));

        // Pausing mid-job (the Esc menu) keeps the job.
        map.paused(true);
        assert!(run.frame(&map).job.is_some());
        map.paused(false);

        map.odometer(51_406.0);
        map.speed(0.0);
        map.paused(true); // the delivery screen
        map.deliver(0.012);
        let frame = run.frame(&map);
        assert_eq!(frame.gameplay_event, Some(GameplayEvent::JobDelivered));
        assert_eq!(frame.job, None);
        events.extend(tracker.push(&frame));

        // Nothing more happens afterwards.
        let frame = run.frame(&map);
        assert_eq!(frame.gameplay_event, None);
        events.extend(tracker.push(&frame));

        assert_eq!(events.len(), 2, "{events:?}");
        assert!(matches!(events[0], JobEvent::Started { .. }));
        let JobEvent::Finished(job) = &events[1] else {
            panic!("expected a finished job, got {events:?}");
        };
        assert_eq!(job.status, JobStatus::Delivered);
        assert_eq!(job.game, Game::Ets2);
        assert_eq!(job.job.source_city, "Hamburg");
        assert_eq!(job.job.source_company, "Krone Logistics");
        assert_eq!(job.job.destination_company, "TREE-ET");
        assert_eq!(job.job.cargo, "Electronics");
        assert_eq!(job.job.cargo_mass_kg, 18_400.0);
        assert_eq!(job.job.planned_distance_km, 1_196.0);
        assert_eq!(job.job.income, 52_400);
        assert_eq!(job.odometer_start_km, 50_210.0);
        assert_eq!(job.driven_km, 1_196.0);
        assert!((job.max_speed_kmh - 90.0).abs() < 1e-9);
        assert!((job.cargo_damage - 0.012).abs() < 1e-6);
    }

    #[test]
    fn a_cancelled_job_keeps_the_damage_seen_before_it_ended() {
        let mut run = Run::new();
        let mut map = FakeMap::running();
        map.take_job();
        run.frame(&map);
        assert!(run.frame(&map).job.is_some());
        map.cargo_damage(0.25);
        run.frame(&map);

        map.cancel();
        let frame = run.frame(&map);
        assert_eq!(frame.gameplay_event, Some(GameplayEvent::JobCancelled));
        assert_eq!(frame.cargo_damage, 0.25);
    }

    #[test]
    fn the_odometer_of_the_previous_save_is_not_used_as_the_start() {
        let mut run = Run::new();
        let mut tracker = JobTracker::new();
        let mut map = FakeMap::running();
        map.odometer(150_000.0); // the truck in the save played before

        // Another save loads, with a job in progress. The game is paused and
        // the odometer has not been updated yet.
        map.paused(true);
        map.take_job();
        assert!(tracker.push(&run.frame(&map)).is_empty());
        assert!(tracker.push(&run.frame(&map)).is_empty());

        // The save is in: unpaused, and the odometer is this truck's.
        map.paused(false);
        map.odometer(20_000.0);
        assert!(tracker.push(&run.frame(&map)).is_empty());
        assert_eq!(tracker.push(&run.frame(&map)).len(), 1);

        map.odometer(20_300.0);
        map.deliver(0.0);
        let events = tracker.push(&run.frame(&map));
        let Some(JobEvent::Finished(job)) = events.first() else {
            panic!("expected a finished job, got {events:?}");
        };
        assert_eq!(job.odometer_start_km, 20_000.0);
        assert_eq!(job.driven_km, 300.0);
    }

    #[test]
    fn a_half_written_job_is_not_reported() {
        let mut run = Run::new();
        let mut map = FakeMap::running();
        map.take_job();
        map.destination_city("Ly"); // caught the plugin mid-write
        assert_eq!(run.frame(&map).job, None);
        map.destination_city("Lyon");
        assert_eq!(run.frame(&map).job, None, "the details just changed");
        assert_eq!(
            run.frame(&map).job.map(|j| j.destination_city),
            Some("Lyon".to_owned())
        );
    }

    #[test]
    fn a_job_without_cities_is_not_reported() {
        let mut run = Run::new();
        let mut map = FakeMap::running();
        map.take_job();
        map.source_city("");
        run.frame(&map);
        run.frame(&map);
        assert_eq!(run.frame(&map).job, None);
    }

    #[test]
    fn flags_left_over_from_before_the_tracker_started_fire_nothing() {
        let mut run = Run::new();
        let mut map = FakeMap::running();
        // All of this happened before we were looking.
        map.deliver(0.0);
        map.fine("speeding", 550);
        map.toll(38);
        map.ferry("Dover", "Calais", 320);
        map.train("Folkestone", "Calais", 265);
        for _ in 0..3 {
            let frame = run.frame(&map);
            assert_eq!(frame.gameplay_event, None);
            assert_eq!(frame.player_events, []);
        }
    }

    #[test]
    fn a_game_restart_is_not_a_delivery() {
        let mut run = Run::new();
        let mut map = FakeMap::running();
        run.frame(&map);
        map.deliver(0.0);
        assert_eq!(
            run.frame(&map).gameplay_event,
            Some(GameplayEvent::JobDelivered)
        );

        // The game closes, then starts again with a zeroed map: the flag is
        // back to false, which is not an event.
        map.sdk_active(false);
        assert_eq!(run.decoder.decode(&map.0, 0), Ok(None));
        let fresh = FakeMap::running();
        assert_eq!(run.frame(&fresh).gameplay_event, None);
    }

    /// The events of the next few snapshots of an unchanged map.
    fn settle(run: &mut Run, map: &FakeMap) -> Vec<PlayerEvent> {
        (0..3).flat_map(|_| run.frame(map).player_events).collect()
    }

    fn fine(offence: &str, amount: i64) -> PlayerEvent {
        PlayerEvent::Fine {
            offence: offence.to_owned(),
            amount,
        }
    }

    #[test]
    fn a_fine_is_reported_once_with_its_offence_and_amount() {
        let mut run = Run::new();
        let mut map = FakeMap::running();
        run.frame(&map);

        map.fine("speeding", 550);
        assert_eq!(settle(&mut run, &map), [fine("speeding", 550)]);

        // The flag flips back on the next one: also an event.
        map.fine("red_signal", 400);
        assert_eq!(settle(&mut run, &map), [fine("red_signal", 400)]);
        assert_eq!(settle(&mut run, &map), []);
    }

    #[test]
    fn a_toll_is_reported_with_its_amount() {
        let mut run = Run::new();
        let mut map = FakeMap::running();
        run.frame(&map);
        map.toll(38);
        assert_eq!(settle(&mut run, &map), [PlayerEvent::Toll { amount: 38 }]);
    }

    #[test]
    fn a_ferry_is_reported_with_both_ports_and_its_price() {
        let mut run = Run::new();
        let mut map = FakeMap::running();
        run.frame(&map);
        map.ferry("Dover", "Calais", 320);
        assert_eq!(
            settle(&mut run, &map),
            [PlayerEvent::Ferry {
                source: "Dover".to_owned(),
                target: "Calais".to_owned(),
                amount: 320,
            }]
        );
    }

    #[test]
    fn a_train_is_reported_with_both_terminals_and_its_price() {
        let mut run = Run::new();
        let mut map = FakeMap::running();
        run.frame(&map);
        map.train("Folkestone", "Calais", 265);
        assert_eq!(
            settle(&mut run, &map),
            [PlayerEvent::Train {
                source: "Folkestone".to_owned(),
                target: "Calais".to_owned(),
                amount: 265,
            }]
        );
    }

    #[test]
    fn a_ferry_and_a_train_do_not_read_each_others_fields() {
        let mut run = Run::new();
        let mut map = FakeMap::running();
        run.frame(&map);
        map.ferry("Dover", "Calais", 320);
        map.train("Folkestone", "Coquelles", 265);
        map.toll(38);
        map.fine("no_lights", 150);
        // All four in one snapshot come out in a fixed order.
        assert_eq!(
            settle(&mut run, &map),
            [
                fine("no_lights", 150),
                PlayerEvent::Toll { amount: 38 },
                PlayerEvent::Ferry {
                    source: "Dover".to_owned(),
                    target: "Calais".to_owned(),
                    amount: 320,
                },
                PlayerEvent::Train {
                    source: "Folkestone".to_owned(),
                    target: "Coquelles".to_owned(),
                    amount: 265,
                },
            ]
        );
    }

    #[test]
    fn an_event_is_read_after_the_plugin_has_written_its_details() {
        let mut run = Run::new();
        let mut map = FakeMap::running();
        run.frame(&map);
        map.fine("speeding", 550);
        settle(&mut run, &map);

        // Caught the plugin between flipping the flag and writing the
        // details: the map still describes the speeding fine.
        map.fine_flag();
        assert_eq!(run.frame(&map).player_events, []);
        map.fine_details("red_signal", 400);
        assert_eq!(run.frame(&map).player_events, [fine("red_signal", 400)]);
        assert_eq!(run.frame(&map).player_events, []);
    }

    #[test]
    fn an_offence_that_fills_its_field_stops_at_the_field() {
        let mut run = Run::new();
        let mut map = FakeMap::running();
        run.frame(&map);
        // The offence is 32 bytes, half of the other text fields, and the
        // ferry's source port sits right behind it.
        let long = "x".repeat(32);
        map.ferry("Dover", "Calais", 320);
        map.fine(&long, 1);
        assert_eq!(settle(&mut run, &map)[0], fine(&long, 1));
    }

    #[test]
    fn a_game_restart_is_not_a_fine() {
        let mut run = Run::new();
        let mut map = FakeMap::running();
        run.frame(&map);
        map.fine("speeding", 550);
        map.toll(38);
        // Seen, but the game closes before the details are read.
        assert_eq!(run.frame(&map).player_events, []);
        map.sdk_active(false);
        assert_eq!(run.decoder.decode(&map.0, 0), Ok(None));

        // It starts again with a zeroed map: every flag is back to false,
        // and what was waiting is forgotten.
        let fresh = FakeMap::running();
        assert_eq!(settle(&mut run, &fresh), []);
    }

    #[test]
    fn only_what_happens_during_the_job_ends_up_on_it() {
        let mut run = Run::new();
        let mut tracker = JobTracker::new();
        let mut events = Vec::new();
        let mut map = FakeMap::running();
        let mut step = |map: &FakeMap, events: &mut Vec<JobEvent>| {
            let frame = run.frame(map);
            events.extend(tracker.push(&frame));
            frame.t_ms
        };

        // Fined on the way to pick up the job.
        step(&map, &mut events);
        map.fine("wrong_way", 250);
        step(&map, &mut events);
        step(&map, &mut events);

        map.take_job();
        step(&map, &mut events);
        step(&map, &mut events); // the job is reported from here on

        map.toll(38);
        step(&map, &mut events);
        let toll_at = step(&map, &mut events);
        map.fine("speeding", 550);
        step(&map, &mut events);
        let fine_at = step(&map, &mut events);

        // A fine seen one snapshot before the delivery is read in the
        // snapshot of the delivery itself, and still counts.
        map.fine("red_signal", 400);
        step(&map, &mut events);
        map.deliver(0.0);
        let delivered_at = step(&map, &mut events);

        // After the delivery, on the way out of the yard.
        map.toll(12);
        step(&map, &mut events);
        step(&map, &mut events);

        let Some(JobEvent::Finished(job)) = events.last() else {
            panic!("expected a finished job, got {events:?}");
        };
        assert_eq!(
            job.events,
            [
                TimedEvent {
                    at_ms: toll_at,
                    event: PlayerEvent::Toll { amount: 38 },
                },
                TimedEvent {
                    at_ms: fine_at,
                    event: fine("speeding", 550),
                },
                TimedEvent {
                    at_ms: delivered_at,
                    event: fine("red_signal", 400),
                },
            ]
        );
        assert!(job.started_at_ms < toll_at && delivered_at == job.finished_at_ms);
    }

    #[test]
    fn reads_text_that_fills_the_whole_field() {
        let mut run = Run::new();
        let mut map = FakeMap::running();
        map.take_job();
        let long = "Æ".repeat(32); // 64 bytes of UTF-8, no room for a NUL
        map.destination_city(&long);
        run.frame(&map);
        assert_eq!(run.frame(&map).job.map(|j| j.destination_city), Some(long));
    }

    #[test]
    fn bad_numbers_become_zero() {
        let mut map = FakeMap::running();
        map.odometer(f32::NAN);
        map.speed(f32::INFINITY);
        map.position(f64::NAN, 12.0);
        map.cargo_damage(7.0);
        let frame = Run::new().frame(&map);
        assert_eq!(frame.odometer_km, 0.0);
        assert_eq!(frame.speed_ms, 0.0);
        assert_eq!(frame.position, (0.0, 12.0));
        assert_eq!(frame.cargo_damage, 1.0);
    }
}
