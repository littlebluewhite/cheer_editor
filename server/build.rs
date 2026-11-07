// 遷移是編譯時包進程式的；只加了新的 .sql 檔，Cargo 不會自己重編，所以叫它看著這個資料夾。
fn main() {
    println!("cargo:rerun-if-changed=migrations");
}
