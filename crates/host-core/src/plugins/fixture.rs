// Offline curated-market fixture admission. Production builds always reject it.
pub(crate) fn is_plus_curated_fixture_enabled() -> bool {
    #[cfg(debug_assertions)]
    {
        std::env::var("PI_DESKTOP_PLUS_CURATED_FIXTURE").as_deref() == Ok("1")
            && std::env::var("PI_DESKTOP_CAPTURE").as_deref() == Ok("1")
    }
    #[cfg(not(debug_assertions))]
    {
        false
    }
}

pub(crate) fn is_valid_fixture_file_url(url: &str) -> bool {
    let Some(path_str) = url.strip_prefix("file://") else {
        return false;
    };
    if !is_plus_curated_fixture_enabled() {
        return false;
    }
    let Ok(temp_root) = std::env::temp_dir().canonicalize() else {
        return false;
    };
    let path = std::path::Path::new(path_str);
    let Ok(canonical_path) = path.canonicalize() else {
        return false;
    };
    if !canonical_path.starts_with(&temp_root) {
        return false;
    }
    let mut current = canonical_path.parent();
    while let Some(dir) = current {
        if dir.join("plus-curated-fixture-v1.json").exists()
            || dir.join("pi-desktop-plus-curated-fixture-v1.json").exists()
        {
            return true;
        }
        if dir == temp_root {
            break;
        }
        current = dir.parent();
    }
    false
}
