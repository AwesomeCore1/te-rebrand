//! Files in the app data folder: the device token and the offline job queue.
//!
//! The token file is readable only by the current user. It's the same kind of
//! secret as a browser session cookie; revoke it from the website's dashboard.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use te_telemetry::upload::JobUpload;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Auth {
    pub token: String,
    pub driver_name: String,
}

pub struct Store {
    dir: PathBuf,
}

impl Store {
    pub fn new(dir: PathBuf) -> io::Result<Self> {
        fs::create_dir_all(&dir)?;
        Ok(Self { dir })
    }

    fn path(&self, name: &str) -> PathBuf {
        self.dir.join(name)
    }

    pub fn load_auth(&self) -> Option<Auth> {
        read_json(&self.path("auth.json"))
    }

    /// `None` forgets the token (unlink).
    pub fn save_auth(&self, auth: Option<&Auth>) -> io::Result<()> {
        let path = self.path("auth.json");
        match auth {
            Some(auth) => write_private(&path, &serde_json::to_vec(auth)?),
            None => match fs::remove_file(&path) {
                Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
                other => other,
            },
        }
    }

    /// Jobs waiting to be sent, oldest first. Survives restarts and being offline.
    pub fn load_queue(&self) -> Vec<JobUpload> {
        read_json(&self.path("queue.json")).unwrap_or_default()
    }

    pub fn save_queue(&self, queue: &[JobUpload]) -> io::Result<()> {
        write_private(&self.path("queue.json"), &serde_json::to_vec_pretty(queue)?)
    }

    /// Jobs the API refused (422 etc.). Kept for support instead of being retried forever.
    pub fn append_rejected(&self, job: &JobUpload, reason: &str) -> io::Result<()> {
        use std::io::Write;
        let line = serde_json::json!({ "reason": reason, "upload": job });
        let mut f = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.path("rejected.jsonl"))?;
        writeln!(f, "{line}")
    }
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    let bytes = fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Write to a temp file, then rename, so a crash never leaves half a file.
fn write_private(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600))?;
    }
    fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store() -> Store {
        let dir = std::env::temp_dir().join(format!("tacho-test-{}", uuid::Uuid::new_v4()));
        Store::new(dir).unwrap()
    }

    fn fixture() -> JobUpload {
        serde_json::from_str(include_str!(
            "../../../../crates/telemetry/tests/fixtures/job-upload.json"
        ))
        .unwrap()
    }

    #[test]
    fn queue_survives_a_restart() {
        let store = temp_store();
        assert!(store.load_queue().is_empty());
        store.save_queue(&[fixture()]).unwrap();
        let reopened = Store::new(store.dir.clone()).unwrap();
        assert_eq!(reopened.load_queue(), vec![fixture()]);
    }

    #[test]
    fn auth_can_be_saved_and_forgotten() {
        let store = temp_store();
        let auth = Auth {
            token: "te_dev_x".into(),
            driver_name: "A".into(),
        };
        store.save_auth(Some(&auth)).unwrap();
        assert_eq!(store.load_auth().unwrap().token, "te_dev_x");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(store.path("auth.json"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        store.save_auth(None).unwrap();
        store.save_auth(None).unwrap(); // forgetting twice is fine
        assert!(store.load_auth().is_none());
    }
}
