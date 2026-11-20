// `cheer-server migrate`：Fly 的 release_command 在部署前跑它（fly.toml）。
// 沒跑成就回非 0，Fly 就不部署；跑成就回 0、馬上結束（不開伺服器）。

use std::process::{Command, Output};

/// 在一個空的資料夾跑（不讀到別人的 server/.env），只給 DATABASE_URL。
fn migrate(database_url: &str) -> Output {
    let dir = tempfile::tempdir().unwrap();
    Command::new(env!("CARGO_BIN_EXE_cheer-server"))
        .arg("migrate")
        .current_dir(dir.path())
        .env_clear()
        .env("DATABASE_URL", database_url)
        .output()
        .unwrap()
}

/// 這個測試自己那個資料庫的連線字串：DATABASE_URL 換成它的名字。
async fn url_of(db: &sqlx::PgPool) -> String {
    let (name,): (String,) = sqlx::query_as("SELECT current_database()")
        .fetch_one(db)
        .await
        .unwrap();
    let mut url: reqwest::Url = std::env::var("DATABASE_URL").unwrap().parse().unwrap();
    url.set_path(&name);
    url.to_string()
}

async fn applied(db: &sqlx::PgPool) -> Vec<i64> {
    sqlx::query_scalar("SELECT version FROM _sqlx_migrations WHERE success ORDER BY version")
        .fetch_all(db)
        .await
        .unwrap()
}

#[sqlx::test(migrations = false)]
async fn migrate_applies_every_migration_and_exits(db: sqlx::PgPool) {
    let out = migrate(&url_of(&db).await);

    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let expected: Vec<i64> = cheer_server::MIGRATOR.iter().map(|m| m.version).collect();
    assert_eq!(applied(&db).await, expected);
}

#[test]
fn migrate_fails_when_the_database_is_unreachable() {
    // 沒有人在聽的埠：連不上就要回非 0，Fly 才不部署。
    let out = migrate("postgres://nobody:nothing@127.0.0.1:1/nothing");

    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("連不上資料庫"));
}

#[sqlx::test(migrations = false)]
async fn migrate_accepts_a_newer_migration_already_applied(db: sqlx::PgPool) {
    // 新版的 release_command 跑過一個這版沒有的遷移，之後倒回舊版的映像檔（或舊版的機器重開）：
    // 只加不刪，所以舊版照樣能用，不能因為「資料庫多一個遷移」就起不來。
    let url = url_of(&db).await;
    assert!(migrate(&url).status.success());
    sqlx::query(
        "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
         VALUES (99999999, 'from a newer version', true, '\\x00', 0)",
    )
    .execute(&db)
    .await
    .unwrap();

    let out = migrate(&url);

    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
}
