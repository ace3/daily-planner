// =============================================================================
// auth.rs — Session-based authentication helpers
// =============================================================================
//
// Provides:
//   - argon2id password hashing / verification
//   - Session token creation and validation (30-day expiry)
//   - User lookup and password change helpers
// =============================================================================

use anyhow::{Context, Result};
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use rusqlite::{params, Connection};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Minimal user information returned by auth lookups.
#[derive(Debug, Clone)]
pub struct UserInfo {
    pub id: String,
    pub username: String,
    pub must_change_password: bool,
}

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------

/// Hash `password` with argon2id.  Returns the PHC-encoded string.
pub fn hash_password(password: &str) -> Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("argon2 hash error: {}", e))?;
    Ok(hash.to_string())
}

/// Verify `password` against a stored PHC-encoded `hash`.
pub fn verify_password(password: &str, hash: &str) -> Result<bool> {
    let parsed = PasswordHash::new(hash)
        .map_err(|e| anyhow::anyhow!("argon2 parse hash error: {}", e))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}

// ---------------------------------------------------------------------------
// User queries
// ---------------------------------------------------------------------------

/// Fetch a user by username.  Returns `None` if not found.
pub fn get_user_by_username(conn: &Connection, username: &str) -> Result<Option<UserInfo>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, username, must_change_password FROM users WHERE username = ?1 LIMIT 1",
        )
        .context("prepare get_user_by_username")?;

    let mut rows = stmt
        .query_map(params![username], |row| {
            Ok(UserInfo {
                id: row.get(0)?,
                username: row.get(1)?,
                must_change_password: row.get::<_, i64>(2)? != 0,
            })
        })
        .context("query get_user_by_username")?;

    match rows.next() {
        Some(Ok(u)) => Ok(Some(u)),
        Some(Err(e)) => Err(e.into()),
        None => Ok(None),
    }
}

/// Fetch a user by id.  Returns `None` if not found.
pub fn get_user_by_id(conn: &Connection, user_id: &str) -> Result<Option<UserInfo>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, username, must_change_password FROM users WHERE id = ?1 LIMIT 1",
        )
        .context("prepare get_user_by_id")?;

    let mut rows = stmt
        .query_map(params![user_id], |row| {
            Ok(UserInfo {
                id: row.get(0)?,
                username: row.get(1)?,
                must_change_password: row.get::<_, i64>(2)? != 0,
            })
        })
        .context("query get_user_by_id")?;

    match rows.next() {
        Some(Ok(u)) => Ok(Some(u)),
        Some(Err(e)) => Err(e.into()),
        None => Ok(None),
    }
}

/// Also fetch the password hash (needed only during login verification).
pub fn get_password_hash(conn: &Connection, user_id: &str) -> Result<Option<String>> {
    let mut stmt = conn
        .prepare("SELECT password_hash FROM users WHERE id = ?1 LIMIT 1")
        .context("prepare get_password_hash")?;

    let mut rows = stmt
        .query_map(params![user_id], |row| row.get(0))
        .context("query get_password_hash")?;

    match rows.next() {
        Some(Ok(h)) => Ok(Some(h)),
        Some(Err(e)) => Err(e.into()),
        None => Ok(None),
    }
}

/// Update a user's password hash and clear the `must_change_password` flag.
pub fn change_password(conn: &Connection, user_id: &str, new_hash: &str) -> Result<()> {
    conn.execute(
        "UPDATE users SET password_hash = ?1, must_change_password = 0, updated_at = datetime('now') WHERE id = ?2",
        params![new_hash, user_id],
    )
    .context("update password")?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

/// Create a new session for `user_id` with a 30-day expiry.
/// Returns the opaque session token (UUID v4).
pub fn create_session(conn: &Connection, user_id: &str) -> Result<String> {
    let token = uuid::Uuid::new_v4().to_string();
    let expires_at = chrono::Utc::now()
        + chrono::Duration::days(30);
    let expires_str = expires_at.format("%Y-%m-%dT%H:%M:%SZ").to_string();

    conn.execute(
        "INSERT INTO sessions (user_id, token, expires_at) VALUES (?1, ?2, ?3)",
        params![user_id, token, expires_str],
    )
    .context("insert session")?;

    Ok(token)
}

/// Validate a session token.  Returns the `user_id` if the token exists and
/// has not expired; returns `None` otherwise.
pub fn validate_session(conn: &Connection, token: &str) -> Result<Option<String>> {
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string();

    let mut stmt = conn
        .prepare(
            "SELECT user_id FROM sessions WHERE token = ?1 AND expires_at > ?2 LIMIT 1",
        )
        .context("prepare validate_session")?;

    let mut rows = stmt
        .query_map(params![token, now], |row| row.get(0))
        .context("query validate_session")?;

    match rows.next() {
        Some(Ok(uid)) => Ok(Some(uid)),
        Some(Err(e)) => Err(e.into()),
        None => Ok(None),
    }
}

/// Delete all sessions whose `expires_at` is in the past.
pub fn cleanup_expired_sessions(conn: &Connection) -> Result<()> {
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string();
    conn.execute(
        "DELETE FROM sessions WHERE expires_at <= ?1",
        params![now],
    )
    .context("cleanup expired sessions")?;
    Ok(())
}

/// Delete a specific session (logout).
pub fn delete_session(conn: &Connection, token: &str) -> Result<()> {
    conn.execute("DELETE FROM sessions WHERE token = ?1", params![token])
        .context("delete session")?;
    Ok(())
}
