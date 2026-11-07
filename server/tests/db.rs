// `#[sqlx::test]` 的例子：每個測試自己一個乾淨的資料庫，先跑完 migrations/ 的遷移。
// 要有 PostgreSQL：環境變數 DATABASE_URL 指到一個能開新資料庫的帳號（見 docs/deploy.md）。

#[sqlx::test]
async fn first_migration_runs(db: sqlx::PgPool) {
    let applied: Vec<(i64, bool)> =
        sqlx::query_as("SELECT version, success FROM _sqlx_migrations ORDER BY version")
            .fetch_all(&db)
            .await
            .unwrap();

    assert_eq!(applied.first(), Some(&(1, true)));
}
