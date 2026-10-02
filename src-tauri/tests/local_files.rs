use axum::{
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use ember_bridge_lib::emberconnect::{EmberConnectClient, TokenStore};
use ember_bridge_lib::machine::MachineError;
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicU32, Ordering},
    Arc,
};

async fn exercise(
    protocol: u32,
    expected: &str,
    status: StatusCode,
    code: &str,
) -> (Result<Value, MachineError>, u32, u32) {
    let calls = Arc::new(AtomicU32::new(0));
    let redirects = Arc::new(AtomicU32::new(0));
    let seen = calls.clone();
    let followed = redirects.clone();
    let code = code.to_string();
    let app=Router::new()
        .route("/api/health",get(move || async move {Json(json!({"ok":true,"name":"Ember Link","serial":"AABBCCDDEEFF","fileSystemProtocolVersion":protocol}))}))
        .route("/api/info",get(|| async {Json(json!({"name":"Ember Link","serial":"AABBCCDDEEFF","storage":{"totalBytes":1000,"freeBytes":800}}))}))
        .route("/api/fs",post(move |headers:HeaderMap,Json(body):Json<Value>| {let seen=seen.clone(); let code=code.clone(); async move {
            assert_eq!(headers.get("authorization").unwrap(),"Bearer local-test-only");
            assert_eq!(body["confirmedIdle"],true); assert_eq!(body["op"],"delete");
            seen.fetch_add(1,Ordering::SeqCst);
            (status,[("location","/unexpected")],Json(if status.is_success() {json!({"path":"","revision":"0123456789abcdef","entries":[],"total":0,"hidden":0,"nextOffset":null})} else {json!({"error":{"code":code,"message":"ignored untrusted device message"}})}))
        }}))
        .route("/unexpected",post(move || {let followed=followed.clone(); async move {followed.fetch_add(1,Ordering::SeqCst);Json(json!({}))}}));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let dir = std::env::temp_dir().join(format!("link-fs-{}-{port}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let store = Arc::new(TokenStore::load(&dir));
    store.set("AABBCCDDEEFF", "local-test-only");
    let client = EmberConnectClient::with_port("127.0.0.1".parse().unwrap(), port, store);
    let result=client.filesystem(expected,&json!({"op":"delete","path":"rose.pes","revision":"0123456789abcdef","confirmedIdle":true})).await;
    task.abort();
    std::fs::remove_dir_all(dir).unwrap();
    (
        result,
        calls.load(Ordering::SeqCst),
        redirects.load(Ordering::SeqCst),
    )
}
#[tokio::test]
async fn filesystem_checks_identity_and_capability_before_posting() {
    let (r, n, _) = exercise(1, "WRONG", StatusCode::OK, "").await;
    assert!(matches!(r, Err(MachineError::IdentityChanged)));
    assert_eq!(n, 0);
    let (r, n, _) = exercise(0, "AABBCCDDEEFF", StatusCode::OK, "").await;
    assert!(r.unwrap_err().to_string().contains("Update Ember Link"));
    assert_eq!(n, 0);
    let (r, n, _) = exercise(1, "AABBCCDDEEFF", StatusCode::OK, "").await;
    assert!(r.is_ok());
    assert_eq!(n, 1);
}
#[tokio::test]
async fn file_mutations_are_not_replayed_or_redirected() {
    for status in [
        StatusCode::INTERNAL_SERVER_ERROR,
        StatusCode::TEMPORARY_REDIRECT,
        StatusCode::UNAUTHORIZED,
    ] {
        let (r, n, redirects) = exercise(1, "AABBCCDDEEFF", status, "unauthorized").await;
        assert!(r.is_err());
        assert_eq!(n, 1);
        assert_eq!(redirects, 0);
    }
}
#[tokio::test]
async fn conflicts_are_actionable_and_do_not_repeat_changes() {
    for (code, message) in [
        ("stale_listing", "folder changed"),
        ("already_exists", "already exists"),
        ("folder_not_empty", "contains files"),
    ] {
        let (r, n, _) = exercise(1, "AABBCCDDEEFF", StatusCode::CONFLICT, code).await;
        assert!(r.unwrap_err().to_string().contains(message));
        assert_eq!(n, 1);
    }
}
