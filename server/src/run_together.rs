//! 一起記全上（#262，ADR 0012）：誰在哪次全上的表裡、誰拿著哪幾組、點過沒，只放伺服器記憶體（房間裡），不存資料庫。
//! 手機每次連上（斷線回來、伺服器重開後都是）自己再報一次「我在哪次全上、拿著哪幾組、點過哪幾組」。
//! 組是手機給的字（例：「n:2」是第 2 組，跨動作一起選；騰翻、跳躍每個人一個），伺服器不看裡面。
//! 拿一組：沒人拿著、拿著的人還沒點過記號、或拿著的人已經離開（斷線超過 1 分鐘）就給他；點過的拿不走；
//! 搶同一組照收到的先後，後到的退回（送的人說他看到誰拿著，不是那個人了就是別人先拿了）。
//! 表裡的人都離開了，那次全上就沒了，不能再加入（重報的人回得來）。
//! 真正擋住「一組記兩次」的是存紀錄（records.rs：同一次同一組只收先存的）。

use chrono::{DateTime, Utc};
use serde::Serialize;
use ts_rs::TS;

/// 斷線多久就當他離開那張表。
const GONE_SECONDS: i64 = 60;

/// 一支流程開著的全上（照開的先後）。
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Runs(Vec<Run>);

#[derive(Clone, Debug, PartialEq)]
struct Run {
    id: String,
    date: String,
    started_at: i64,
    /// 表裡的人，照進來的先後。
    people: Vec<Person>,
    /// 誰拿著哪一組，照拿的先後。
    keys: Vec<Hold>,
}

#[derive(Clone, Debug, PartialEq)]
struct Person {
    user_id: i64,
    name: String,
    /// 這個人在這張表上連著的連線。
    conns: Vec<u64>,
    /// 連線都斷了的時間。
    away_since: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, PartialEq)]
struct Hold {
    key: String,
    user_id: i64,
    touched: bool,
}

/// 誰送的：哪個人、哪個連線、叫什麼。
pub struct Who<'a> {
    pub user_id: i64,
    pub conn: u64,
    pub name: &'a str,
}

/// 我在這次全上的表裡（開、加入、連上時再報）。
pub struct Report {
    pub id: String,
    pub date: String,
    pub started_at: i64,
    pub keys: Vec<String>,
    pub touched: Vec<String>,
    /// 加入別人開的（不是自己開的、不是重報）：那次已經沒了就不能加入。
    pub joining: bool,
}

/// 做了之後要跟送的人說的（別人照全上的新樣子）。
#[derive(Debug, PartialEq)]
pub enum Answer {
    /// 好了（全上有沒有變另外看）。
    Done,
    /// 這一組別人拿著：拿著的人的名字、點過了沒。
    Refused { by: String, touched: bool },
    /// 那次全上的人都離開了，不能加入。
    Closed,
}

/// 送給能記的人的一次全上（照看的人寫哪些是他的）。
#[derive(Serialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RunView {
    pub id: String,
    pub date: String,
    #[ts(type = "number")]
    pub started_at: i64,
    /// 還在表裡的人（斷線不到 1 分鐘的也算），照進來的先後。
    pub people: Vec<RunPerson>,
    /// 有人拿著的組（離開了的人拿著的也列，別人能接手）。
    pub keys: Vec<RunKey>,
}

#[derive(Serialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RunPerson {
    pub name: String,
    /// 是看的人自己。
    pub me: bool,
    /// 斷線了。
    pub away: bool,
}

#[derive(Serialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RunKey {
    pub key: String,
    /// 拿著的人（拿這一組時說「我看到是他拿著」）。
    #[ts(type = "number")]
    pub user_id: i64,
    pub name: String,
    pub mine: bool,
    /// 點過記號了。
    pub touched: bool,
    /// 拿著的人斷線了。
    pub away: bool,
}

/// 用戶端送的一起記全上的事（RoomRequest 裡的幾種）。
pub enum Ask {
    Claim { key: String, from: Option<i64> },
    Release { key: String },
    Touch { key: String },
    Leave,
}

impl Person {
    fn gone(&self, now: DateTime<Utc>) -> bool {
        self.away_since
            .is_some_and(|t| now - t >= chrono::Duration::seconds(GONE_SECONDS))
    }
}

impl Run {
    fn person(&self, user_id: i64) -> Option<&Person> {
        self.people.iter().find(|p| p.user_id == user_id)
    }

    fn name_of(&self, user_id: i64) -> String {
        self.person(user_id)
            .map(|p| p.name.clone())
            .unwrap_or_default()
    }

    /// 沒有人還在表裡（都離開了）。
    fn empty(&self, now: DateTime<Utc>) -> bool {
        self.people.iter().all(|p| p.gone(now))
    }

    /// 這個人進表裡（或連回來）。
    fn enter(&mut self, who: &Who) {
        match self.people.iter_mut().find(|p| p.user_id == who.user_id) {
            Some(p) => {
                if !p.conns.contains(&who.conn) {
                    p.conns.push(who.conn);
                }
                p.away_since = None;
            }
            None => self.people.push(Person {
                user_id: who.user_id,
                name: who.name.to_owned(),
                conns: vec![who.conn],
                away_since: None,
            }),
        }
    }

    /// 這個人離開表：拿著的組放掉。
    fn drop_person(&mut self, user_id: i64) {
        self.people.retain(|p| p.user_id != user_id);
        self.keys.retain(|h| h.user_id != user_id);
    }

    fn view(&self, viewer: i64, now: DateTime<Utc>) -> RunView {
        let away = |user_id: i64| self.person(user_id).is_none_or(|p| p.away_since.is_some());
        RunView {
            id: self.id.clone(),
            date: self.date.clone(),
            started_at: self.started_at,
            people: self
                .people
                .iter()
                .filter(|p| !p.gone(now))
                .map(|p| RunPerson {
                    name: p.name.clone(),
                    me: p.user_id == viewer,
                    away: p.away_since.is_some(),
                })
                .collect(),
            keys: self
                .keys
                .iter()
                .map(|h| RunKey {
                    key: h.key.clone(),
                    user_id: h.user_id,
                    name: self.name_of(h.user_id),
                    mine: h.user_id == viewer,
                    touched: h.touched,
                    away: away(h.user_id),
                })
                .collect(),
        }
    }
}

impl Runs {
    /// 都離開了的全上拿掉。
    fn prune(&mut self, now: DateTime<Utc>) {
        self.0.retain(|r| !r.empty(now));
    }

    /// 有沒有開著的全上。
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// 給 viewer 看的每次全上。
    pub fn view(&self, viewer: i64, now: DateTime<Utc>) -> Vec<RunView> {
        self.0
            .iter()
            .filter(|r| !r.empty(now))
            .map(|r| r.view(viewer, now))
            .collect()
    }

    /// 開、加入、重報：還沒有這次就開一次（加入的不行：都離開了）。報的組：自己拿著的留著、沒人拿著的給他，
    /// 別人拿著的不給；自己拿著、沒報的放掉。點過的記下。
    pub fn report(&mut self, who: &Who, report: Report, now: DateTime<Utc>) -> Answer {
        self.prune(now);
        let run = match self.0.iter_mut().position(|r| r.id == report.id) {
            Some(i) => &mut self.0[i],
            None if report.joining => return Answer::Closed,
            None => {
                self.0.push(Run {
                    id: report.id.clone(),
                    date: report.date,
                    started_at: report.started_at,
                    people: vec![],
                    keys: vec![],
                });
                self.0.last_mut().expect("剛放進去")
            }
        };
        run.enter(who);
        run.keys
            .retain(|h| h.user_id != who.user_id || report.keys.contains(&h.key));
        for key in report.keys {
            let touched = report.touched.contains(&key);
            match run.keys.iter_mut().find(|h| h.key == key) {
                Some(h) if h.user_id == who.user_id => h.touched |= touched,
                Some(_) => {}
                None => run.keys.push(Hold {
                    key,
                    user_id: who.user_id,
                    touched,
                }),
            }
        }
        Answer::Done
    }

    /// 拿、放掉、點了一組，或離開表（存好、取消）。
    pub fn ask(&mut self, who: &Who, run_id: &str, ask: Ask, now: DateTime<Utc>) -> Answer {
        self.prune(now);
        let Some(run) = self.0.iter_mut().find(|r| r.id == run_id) else {
            return Answer::Closed;
        };
        match ask {
            Ask::Leave => {
                run.drop_person(who.user_id);
                self.prune(now);
                return Answer::Done;
            }
            Ask::Release { key } => {
                run.keys
                    .retain(|h| h.key != key || h.user_id != who.user_id);
                return Answer::Done;
            }
            Ask::Claim { key, from } => {
                run.enter(who);
                let Some(i) = run.keys.iter().position(|h| h.key == key) else {
                    run.keys.push(Hold {
                        key,
                        user_id: who.user_id,
                        touched: false,
                    });
                    return Answer::Done;
                };
                let h = &run.keys[i];
                if h.user_id == who.user_id {
                    return Answer::Done;
                }
                let gone = run.person(h.user_id).is_none_or(|p| p.gone(now));
                if !gone && (from != Some(h.user_id) || h.touched) {
                    return Answer::Refused {
                        by: run.name_of(h.user_id),
                        touched: h.touched && from == Some(h.user_id),
                    };
                }
                run.keys[i] = Hold {
                    key,
                    user_id: who.user_id,
                    touched: false,
                };
            }
            Ask::Touch { key } => match run.keys.iter_mut().find(|h| h.key == key) {
                Some(h) if h.user_id == who.user_id => h.touched = true,
                Some(h) => {
                    let (by, touched) = (h.user_id, h.touched);
                    return Answer::Refused {
                        by: run.name_of(by),
                        touched,
                    };
                }
                None => run.keys.push(Hold {
                    key,
                    user_id: who.user_id,
                    touched: true,
                }),
            },
        }
        // 離開了的人沒拿著組了：不用再留
        run.people
            .retain(|p| !p.gone(now) || run.keys.iter().any(|h| h.user_id == p.user_id));
        Answer::Done
    }

    /// 一個連線斷了：這個人在表上沒有別的連線，就記下斷線的時間。回有沒有變。
    pub fn disconnect(&mut self, conn: u64, now: DateTime<Utc>) -> bool {
        let mut changed = false;
        for p in self.0.iter_mut().flat_map(|r| r.people.iter_mut()) {
            if p.conns.contains(&conn) {
                p.conns.retain(|c| *c != conn);
                if p.conns.is_empty() {
                    p.away_since = Some(now);
                }
                changed = true;
            }
        }
        changed
    }

    /// 被收回、降成檢視者：踢出每張表，拿著的組放掉。
    pub fn kick(&mut self, user_id: i64, now: DateTime<Utc>) {
        for r in &mut self.0 {
            r.drop_person(user_id);
        }
        self.prune(now);
    }
}
