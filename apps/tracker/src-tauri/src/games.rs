//! Finds ETS2 and ATS on this PC through Steam.
//!
//! The registry says where Steam is, `steamapps/libraryfolders.vdf` lists its
//! libraries, and each library has an `appmanifest_<id>.acf` per installed
//! game that names the game's folder. Everything here only reads.
//!
//! Reading the files is plain text parsing and works on every platform; only
//! the registry lookup is Windows-only.

use std::fs;
use std::path::{Component, Path, PathBuf};

use te_telemetry::Game;

pub const GAMES: [Game; 2] = [Game::Ets2, Game::Ats];

/// The game's Steam app id.
pub const fn app_id(game: Game) -> u32 {
    match game {
        Game::Ets2 => 227_300,
        Game::Ats => 270_880,
    }
}

pub const fn name(game: Game) -> &'static str {
    match game {
        Game::Ets2 => "Euro Truck Simulator 2",
        Game::Ats => "American Truck Simulator",
    }
}

/// One value in Valve's KeyValues text format ("VDF"), which Steam uses for
/// `libraryfolders.vdf` and the app manifests.
#[derive(Debug, PartialEq)]
enum Vdf {
    Text(String),
    Block(Vec<(String, Vdf)>),
}

impl Vdf {
    /// The child with this key. Steam is not consistent about case.
    fn get(&self, key: &str) -> Option<&Vdf> {
        match self {
            Vdf::Block(pairs) => pairs
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case(key))
                .map(|(_, v)| v),
            Vdf::Text(_) => None,
        }
    }

    fn text(&self) -> Option<&str> {
        match self {
            Vdf::Text(text) => Some(text),
            Vdf::Block(_) => None,
        }
    }
}

#[derive(Debug, PartialEq)]
enum Token {
    Text(String),
    Open,
    Close,
}

/// Splits VDF into strings and braces. Strings are normally quoted, with
/// backslash escapes (`\\` in every Windows path).
fn tokens(text: &str) -> Vec<Token> {
    let mut out = Vec::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            c if c.is_whitespace() => {}
            '{' => out.push(Token::Open),
            '}' => out.push(Token::Close),
            '/' if chars.peek() == Some(&'/') => {
                // A comment runs to the end of the line.
                for c in chars.by_ref() {
                    if c == '\n' {
                        break;
                    }
                }
            }
            '"' => {
                let mut s = String::new();
                while let Some(c) = chars.next() {
                    match c {
                        '"' => break,
                        '\\' => match chars.next() {
                            Some('n') => s.push('\n'),
                            Some('t') => s.push('\t'),
                            Some(other) => s.push(other),
                            None => {}
                        },
                        c => s.push(c),
                    }
                }
                out.push(Token::Text(s));
            }
            c => {
                let mut s = String::from(c);
                while let Some(&next) = chars.peek() {
                    if next.is_whitespace() || matches!(next, '{' | '}' | '"') {
                        break;
                    }
                    s.push(next);
                    chars.next();
                }
                out.push(Token::Text(s));
            }
        }
    }
    out
}

/// Reads `"key" "value"` and `"key" { ... }` pairs until the block closes.
fn parse_pairs(tokens: &mut std::vec::IntoIter<Token>, depth: usize) -> Option<Vdf> {
    let mut pairs = Vec::new();
    loop {
        let key = match tokens.next() {
            Some(Token::Text(key)) => key,
            Some(Token::Close) if depth > 0 => break,
            None if depth == 0 => break,
            _ => return None,
        };
        let value = match tokens.next()? {
            Token::Text(text) => Vdf::Text(text),
            // Steam's files nest three or four levels; refuse absurd depth.
            Token::Open if depth < 32 => parse_pairs(tokens, depth + 1)?,
            _ => return None,
        };
        pairs.push((key, value));
    }
    Some(Vdf::Block(pairs))
}

fn parse_vdf(text: &str) -> Option<Vdf> {
    parse_pairs(&mut tokens(text).into_iter(), 0)
}

/// The library folders listed in `libraryfolders.vdf`, in file order.
///
/// Reads both shapes Steam has used: a block per library with a `path`
/// (since 2021), and the older `"1" "D:\\SteamLibrary"`.
pub fn library_folders(vdf: &str) -> Vec<PathBuf> {
    let Some(root) = parse_vdf(vdf) else {
        return Vec::new();
    };
    let Some(Vdf::Block(entries)) = root.get("libraryfolders") else {
        return Vec::new();
    };
    entries
        .iter()
        .filter(|(key, _)| !key.is_empty() && key.chars().all(|c| c.is_ascii_digit()))
        .filter_map(|(_, value)| match value {
            Vdf::Block(_) => value.get("path")?.text(),
            Vdf::Text(path) => Some(path.as_str()),
        })
        .filter(|path| !path.trim().is_empty())
        .map(PathBuf::from)
        .collect()
}

/// The folder name under `steamapps/common` from an `appmanifest_*.acf`.
///
/// Only a plain folder name is accepted, never a path: the plugin is later
/// written below this folder.
pub fn install_dir(manifest: &str) -> Option<String> {
    let root = parse_vdf(manifest)?;
    let dir = root.get("AppState")?.get("installdir")?.text()?.trim();
    let mut parts = Path::new(dir).components();
    match (parts.next(), parts.next()) {
        (Some(Component::Normal(_)), None) if !dir.contains(['/', '\\']) => Some(dir.to_owned()),
        _ => None,
    }
}

/// All Steam libraries: the Steam folder itself, then the ones it lists.
pub fn libraries(steam: &Path) -> Vec<PathBuf> {
    let mut all = vec![steam.to_path_buf()];
    // `config/` is where older Steam versions kept the list.
    for list in ["steamapps/libraryfolders.vdf", "config/libraryfolders.vdf"] {
        if let Ok(text) = fs::read_to_string(steam.join(list)) {
            for library in library_folders(&text) {
                if !all.iter().any(|known| same_folder(known, &library)) {
                    all.push(library);
                }
            }
        }
    }
    all
}

/// Windows paths ignore case and Steam mixes `/` and `\`.
fn same_folder(a: &Path, b: &Path) -> bool {
    let key = |p: &Path| {
        p.to_string_lossy()
            .replace('\\', "/")
            .trim_end_matches('/')
            .to_lowercase()
    };
    key(a) == key(b)
}

/// The game's install folder, if one of the libraries has it.
///
/// A manifest alone is not enough: Steam writes it when a download starts.
/// The game counts as installed once `bin/win_x64` exists.
pub fn find_game(libraries: &[PathBuf], game: Game) -> Option<PathBuf> {
    libraries.iter().find_map(|library| {
        let steamapps = library.join("steamapps");
        let manifest =
            fs::read_to_string(steamapps.join(format!("appmanifest_{}.acf", app_id(game)))).ok()?;
        let folder = steamapps.join("common").join(install_dir(&manifest)?);
        folder
            .join("bin")
            .join("win_x64")
            .is_dir()
            .then_some(folder)
    })
}

/// Where the registry says Steam is installed. Empty when Steam is not installed.
#[cfg(windows)]
pub fn steam_folders() -> Vec<PathBuf> {
    use winreg::RegKey;
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

    // The machine-wide entries first: they spell the path the way Explorer
    // shows it, the per-user one is lower case with forward slashes.
    const PLACES: [(winreg::HKEY, &str, &str); 3] = [
        (
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\WOW6432Node\Valve\Steam",
            "InstallPath",
        ),
        (HKEY_LOCAL_MACHINE, r"SOFTWARE\Valve\Steam", "InstallPath"),
        (HKEY_CURRENT_USER, r"Software\Valve\Steam", "SteamPath"),
    ];
    let mut found: Vec<PathBuf> = Vec::new();
    for (hive, key, value) in PLACES {
        let path = RegKey::predef(hive)
            .open_subkey(key)
            .and_then(|key| key.get_value::<String, _>(value));
        if let Ok(path) = path {
            let path = PathBuf::from(path.replace('/', "\\"));
            if path.is_dir() && !found.iter().any(|known| same_folder(known, &path)) {
                found.push(path);
            }
        }
    }
    found
}

/// Game telemetry is Windows-only, so elsewhere there is nothing to look for.
#[cfg(not(windows))]
pub fn steam_folders() -> Vec<PathBuf> {
    Vec::new()
}

pub struct Located {
    pub steam_found: bool,
    /// Every game, with its folder when Steam has it installed.
    pub games: Vec<(Game, Option<PathBuf>)>,
}

pub fn locate() -> Located {
    let steam = steam_folders();
    let mut all: Vec<PathBuf> = Vec::new();
    for library in steam.iter().flat_map(|folder| libraries(folder)) {
        if !all.iter().any(|known| same_folder(known, &library)) {
            all.push(library);
        }
    }
    Located {
        steam_found: !steam.is_empty(),
        games: GAMES
            .into_iter()
            .map(|game| (game, find_game(&all, game)))
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The shape Steam writes today, with the tabs it uses.
    const LIBRARY_FOLDERS: &str = r#""libraryfolders"
{
	"0"
	{
		"path"		"C:\\Program Files (x86)\\Steam"
		"label"		""
		"contentid"		"-7991357218584701172"
		"totalsize"		"0"
		"apps"
		{
			"228980"		"713658978"
		}
	}
	"1"
	{
		"path"		"D:\\Steam Games"
		"label"		""
		"apps"
		{
			"227300"		"33292355826"
			"270880"		"14964354280"
		}
	}
	"2"
	{
		"path"		"B:\\SteamLibrary"
		"apps"
		{
		}
	}
}
"#;

    const MANIFEST: &str = r#""AppState"
{
	"appid"		"227300"
	"universe"		"1"
	"name"		"Euro Truck Simulator 2"
	"StateFlags"		"4"
	"installdir"		"Euro Truck Simulator 2"
	"LastUpdated"		"1793639195"
	"UserConfig"
	{
		"language"		"english"
	}
	"MountedConfig"
	{
	}
}
"#;

    #[test]
    fn lists_every_library_with_spaces_and_unescaped_backslashes() {
        assert_eq!(
            library_folders(LIBRARY_FOLDERS),
            [
                PathBuf::from(r"C:\Program Files (x86)\Steam"),
                PathBuf::from(r"D:\Steam Games"),
                PathBuf::from(r"B:\SteamLibrary"),
            ]
        );
    }

    #[test]
    fn reads_the_old_library_list() {
        let old = r#"
"LibraryFolders"
{
	"TimeNextStatsReport"		"1612345678"
	"ContentStatsID"		"-123456789"
	"1"		"D:\\SteamLibrary"
	"2"		"E:\\Games\\Steam Library"
}
"#;
        assert_eq!(
            library_folders(old),
            [
                PathBuf::from(r"D:\SteamLibrary"),
                PathBuf::from(r"E:\Games\Steam Library"),
            ]
        );
    }

    #[test]
    fn a_broken_or_empty_library_list_gives_no_libraries() {
        assert!(library_folders("").is_empty());
        assert!(library_folders("\"libraryfolders\"").is_empty());
        assert!(library_folders("\"libraryfolders\" { \"0\" { \"path\" ").is_empty());
        assert!(library_folders("\"somethingelse\" { \"0\" \"C:\\\\x\" }").is_empty());
        assert!(library_folders("} }").is_empty());
    }

    #[test]
    fn comments_escapes_and_bare_words_are_read() {
        let text =
            "// written by hand\nlibraryfolders {\n  0 { path \"C:\\\\a \\\"b\\\"\" } // one\n}";
        assert_eq!(library_folders(text), [PathBuf::from(r#"C:\a "b""#)]);
    }

    #[test]
    fn reads_the_install_folder_from_a_manifest() {
        assert_eq!(
            install_dir(MANIFEST).as_deref(),
            Some("Euro Truck Simulator 2")
        );
        assert_eq!(install_dir("\"AppState\" { \"appid\" \"227300\" }"), None);
        assert_eq!(install_dir("not a manifest {"), None);
    }

    #[test]
    fn refuses_an_install_folder_that_is_a_path() {
        for dir in [
            "..",
            "../elsewhere",
            r"..\\elsewhere",
            r"C:\\Windows",
            "a/b",
            "",
        ] {
            let manifest = format!("\"AppState\" {{ \"installdir\" \"{dir}\" }}");
            assert_eq!(install_dir(&manifest), None, "{dir}");
        }
    }

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tacho-games-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Writes a Steam library with one game in it and returns the game's folder.
    fn add_game(library: &Path, game: Game, folder: &str, with_binaries: bool) -> PathBuf {
        let steamapps = library.join("steamapps");
        let game_dir = steamapps.join("common").join(folder);
        fs::create_dir_all(&game_dir).unwrap();
        if with_binaries {
            fs::create_dir_all(game_dir.join("bin").join("win_x64")).unwrap();
        }
        fs::write(
            steamapps.join(format!("appmanifest_{}.acf", app_id(game))),
            format!("\"AppState\"\n{{\n\t\"installdir\"\t\t\"{folder}\"\n}}\n"),
        )
        .unwrap();
        game_dir
    }

    #[test]
    fn finds_each_game_in_the_library_that_has_it() {
        let root = temp_dir();
        let steam = root.join("Program Files (x86)").join("Steam");
        let second = root.join("Steam Games");
        fs::create_dir_all(steam.join("steamapps")).unwrap();
        let escaped = second.to_string_lossy().replace('\\', "\\\\");
        fs::write(
            steam.join("steamapps").join("libraryfolders.vdf"),
            format!(
                "\"libraryfolders\"\n{{\n\t\"0\"\n\t{{\n\t\t\"path\"\t\t\"{}\"\n\t}}\n\t\"1\"\n\t{{\n\t\t\"path\"\t\t\"{escaped}\"\n\t}}\n}}\n",
                steam.to_string_lossy().replace('\\', "\\\\"),
            ),
        )
        .unwrap();
        let ets2 = add_game(&second, Game::Ets2, "Euro Truck Simulator 2", true);

        let all = libraries(&steam);
        assert_eq!(all, [steam.clone(), second.clone()], "Steam itself once");
        assert_eq!(find_game(&all, Game::Ets2), Some(ets2));
        assert_eq!(find_game(&all, Game::Ats), None);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_game_that_is_still_downloading_is_not_installed() {
        let library = temp_dir();
        add_game(&library, Game::Ats, "American Truck Simulator", false);
        assert_eq!(find_game(std::slice::from_ref(&library), Game::Ats), None);
        fs::remove_dir_all(library).unwrap();
    }

    #[test]
    fn the_same_folder_is_recognised_across_spellings() {
        assert!(same_folder(
            Path::new("c:/program files (x86)/steam"),
            Path::new(r"C:\Program Files (x86)\Steam\")
        ));
        assert!(!same_folder(Path::new(r"C:\Steam"), Path::new(r"D:\Steam")));
    }

    /// Read-only check against this PC: `cargo test -p tracker locate -- --ignored --nocapture`.
    #[cfg(windows)]
    #[test]
    #[ignore = "prints what is installed on this PC"]
    fn locate_on_this_pc() {
        println!("Steam: {:?}", steam_folders());
        for folder in steam_folders() {
            println!(
                "libraries of {}: {:?}",
                folder.display(),
                libraries(&folder)
            );
        }
        for (game, folder) in locate().games {
            println!("{}: {folder:?}", name(game));
            if let Some(folder) = folder {
                println!("  plugin: {:?}", crate::plugin::plugin_state(&folder));
            }
        }
    }
}
