//! "Start with Windows": a value under the current user's `Run` key.
//!
//! Off until the driver turns it on in Settings. Started this way, Tacho gets
//! [`FLAG`] and stays in the tray without showing its window.

/// Passed to Tacho when Windows starts it at login.
pub const FLAG: &str = "--autostart";

/// Whether this process was started by Windows at login.
pub fn started_at_login() -> bool {
    has_flag(std::env::args())
}

pub fn has_flag<I: IntoIterator<Item = S>, S: AsRef<str>>(args: I) -> bool {
    args.into_iter().any(|arg| arg.as_ref() == FLAG)
}

pub const SUPPORTED: bool = cfg!(windows);

#[cfg(windows)]
pub use windows::{is_enabled, set_enabled};

#[cfg(not(windows))]
pub fn is_enabled() -> bool {
    false
}

#[cfg(not(windows))]
pub fn set_enabled(_enabled: bool) -> std::io::Result<()> {
    Err(std::io::Error::other(
        "Starting at login is only available on Windows.",
    ))
}

#[cfg(windows)]
mod windows {
    use std::io;
    use std::path::Path;

    use winreg::RegKey;
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE};

    use super::FLAG;

    /// Where the entry lives. Tests point this at a scratch key.
    pub(super) struct Keys<'a> {
        pub run: &'a str,
        /// Task Manager's "Startup apps" switch, kept apart from the entry itself.
        pub approved: &'a str,
        pub name: &'a str,
    }

    const KEYS: Keys = Keys {
        run: r"Software\Microsoft\Windows\CurrentVersion\Run",
        approved: r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run",
        // A development build never takes over the installed app's entry.
        name: if cfg!(debug_assertions) {
            "Tacho (dev)"
        } else {
            "Tacho"
        },
    };

    /// The command line Windows runs. The path is quoted: it usually has spaces.
    pub(super) fn command(exe: &Path) -> String {
        format!("\"{}\" {FLAG}", exe.display())
    }

    pub fn is_enabled() -> bool {
        is_enabled_in(&KEYS)
    }

    pub fn set_enabled(enabled: bool) -> io::Result<()> {
        if enabled {
            enable_in(&KEYS, &std::env::current_exe()?)
        } else {
            disable_in(&KEYS)
        }
    }

    pub(super) fn is_enabled_in(keys: &Keys) -> bool {
        let user = RegKey::predef(HKEY_CURRENT_USER);
        let has_entry = user
            .open_subkey_with_flags(keys.run, KEY_READ)
            .and_then(|run| run.get_value::<String, _>(keys.name))
            .is_ok();
        // Switched off in Task Manager: the first byte is odd.
        let switched_off = user
            .open_subkey_with_flags(keys.approved, KEY_READ)
            .and_then(|approved| approved.get_raw_value(keys.name))
            .is_ok_and(|value| value.bytes.first().is_some_and(|byte| byte & 1 == 1));
        has_entry && !switched_off
    }

    pub(super) fn enable_in(keys: &Keys, exe: &Path) -> io::Result<()> {
        let user = RegKey::predef(HKEY_CURRENT_USER);
        let (run, _) = user.create_subkey(keys.run)?;
        run.set_value(keys.name, &command(exe))?;
        // Forget an earlier "off" from Task Manager, or the entry would not run.
        if let Ok(approved) = user.open_subkey_with_flags(keys.approved, KEY_SET_VALUE) {
            ignore_missing(approved.delete_value(keys.name))?;
        }
        Ok(())
    }

    pub(super) fn disable_in(keys: &Keys) -> io::Result<()> {
        let user = RegKey::predef(HKEY_CURRENT_USER);
        match user.open_subkey_with_flags(keys.run, KEY_SET_VALUE) {
            Ok(run) => ignore_missing(run.delete_value(keys.name)),
            Err(e) => ignore_missing(Err(e)),
        }
    }

    fn ignore_missing(result: io::Result<()>) -> io::Result<()> {
        match result {
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
            other => other,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_login_flag_is_found_among_other_arguments() {
        assert!(has_flag(["tacho.exe", "--autostart"]));
        assert!(has_flag([r"C:\Program", r"Files\Tacho\tacho.exe", FLAG]));
        assert!(!has_flag(["tacho.exe"]));
        assert!(!has_flag(["tacho.exe", "--autostarted"]));
    }

    /// Runs against a scratch key under HKCU that is removed again; the real
    /// `Run` key is not touched.
    #[cfg(windows)]
    #[test]
    fn start_with_windows_can_be_turned_on_and_off() {
        use std::path::Path;

        use winreg::RegKey;
        use winreg::enums::{HKEY_CURRENT_USER, RegType};

        use super::windows::{Keys, command, disable_in, enable_in, is_enabled_in};

        let root = format!(r"Software\TachoTest-{}", uuid::Uuid::new_v4());
        let run = format!(r"{root}\Run");
        let approved = format!(r"{root}\StartupApproved");
        let keys = Keys {
            run: &run,
            approved: &approved,
            name: "Tacho",
        };
        let user = RegKey::predef(HKEY_CURRENT_USER);
        let exe = Path::new(r"C:\Program Files\Tacho\tacho.exe");

        assert!(!is_enabled_in(&keys), "off by default");
        disable_in(&keys).unwrap(); // turning it off twice is fine

        enable_in(&keys, exe).unwrap();
        assert!(is_enabled_in(&keys));
        let written: String = user.open_subkey(&run).unwrap().get_value("Tacho").unwrap();
        assert_eq!(written, r#""C:\Program Files\Tacho\tacho.exe" --autostart"#);
        assert_eq!(written, command(exe));

        // The driver switches it off in Task Manager; turning it on again in
        // Tacho clears that.
        let (approved_key, _) = user.create_subkey(&approved).unwrap();
        let off = winreg::RegValue {
            vtype: RegType::REG_BINARY,
            bytes: vec![3, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8].into(),
        };
        approved_key.set_raw_value("Tacho", &off).unwrap();
        assert!(!is_enabled_in(&keys));
        enable_in(&keys, exe).unwrap();
        assert!(is_enabled_in(&keys));

        disable_in(&keys).unwrap();
        assert!(!is_enabled_in(&keys));
        disable_in(&keys).unwrap();

        user.delete_subkey_all(&root).unwrap();
    }
}
