use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;
use tokio_cron_scheduler::{JobScheduler, Job};

#[derive(Clone, serde::Serialize)]
struct PhaseChangedPayload {
    phase: String,
}

pub async fn setup_scheduler(
    app: AppHandle,
    tz_offset: i64,
    kickstart_time: &str,
    planning_end: &str,
    session2_start: &str,
    warn_before_min: i64,
    work_days: &[i64],
) -> anyhow::Result<JobScheduler> {
    let sched = JobScheduler::new().await?;

    // Parse times
    let (k_h, k_m) = parse_time(kickstart_time);
    let (p_h, p_m) = parse_time(planning_end);
    let (s2_h, s2_m) = parse_time(session2_start);

    // Convert to UTC
    let k_utc_h = ((k_h as i64 - tz_offset).rem_euclid(24)) as u32;
    let p_utc_h = ((p_h as i64 - tz_offset).rem_euclid(24)) as u32;
    let s2_utc_h = ((s2_h as i64 - tz_offset).rem_euclid(24)) as u32;

    let warn_before = warn_before_min as u32;
    let (w2_h, w2_m) = subtract_minutes(s2_utc_h, s2_m, warn_before);

    // End of day is 5h after session2 start
    let (eod2_h, eod2_m) = add_minutes(s2_utc_h, s2_m, 5 * 60);
    let (eod2_warn_h, eod2_warn_m) = subtract_minutes(eod2_h, eod2_m, warn_before);

    // Job 1: Kickstart — session timer starts
    {
        let app = app.clone();
        let cron = format!("0 {} {} * * *", k_m, k_utc_h);
        let job = Job::new_async(cron.as_str(), move |_, _| {
            let app = app.clone();
            Box::pin(async move {
                let _ = app
                    .notification()
                    .builder()
                    .title("Good morning! Start prompting NOW")
                    .body("Your 5-hour Claude session counter starts ticking. Fire up Claude and begin planning!")
                    .show();
                let _ = app.emit("phase-changed", PhaseChangedPayload {
                    phase: "kickstart".to_string(),
                });
            })
        })?;
        sched.add(job).await?;
    }

    // Job 2: Planning end — switch to Claude Code
    {
        let app = app.clone();
        let cron = format!("0 {} {} * * *", p_m, p_utc_h);
        let job = Job::new_async(cron.as_str(), move |_, _| {
            let app = app.clone();
            Box::pin(async move {
                let _ = app
                    .notification()
                    .builder()
                    .title("Time to code!")
                    .body("Planning phase over. Switch to Claude Code and start building.")
                    .show();
                let _ = app.emit("phase-changed", PhaseChangedPayload {
                    phase: "coding".to_string(),
                });
            })
        })?;
        sched.add(job).await?;
    }

    // Job 3: 15-min warning before session2
    {
        let app = app.clone();
        let cron = format!("0 {} {} * * *", w2_m, w2_h);
        let job = Job::new_async(cron.as_str(), move |_, _| {
            let app = app.clone();
            Box::pin(async move {
                let _ = app
                    .notification()
                    .builder()
                    .title("Session resets in 15 min!")
                    .body("Wrap up your current work. Fresh session starts soon — make it count!")
                    .show();
                let _ = app.emit("phase-changed", PhaseChangedPayload {
                    phase: "session1_warning".to_string(),
                });
            })
        })?;
        sched.add(job).await?;
    }

    // Job 4: Session 2 start — fresh reset
    {
        let app = app.clone();
        let cron = format!("0 {} {} * * *", s2_m, s2_utc_h);
        let job = Job::new_async(cron.as_str(), move |_, _| {
            let app = app.clone();
            Box::pin(async move {
                let _ = app
                    .notification()
                    .builder()
                    .title("Fresh session! Keep building.")
                    .body("Your 5-hour session just reset. You've doubled your Claude usage today!")
                    .show();
                let _ = app.emit("phase-changed", PhaseChangedPayload {
                    phase: "session2".to_string(),
                });
            })
        })?;
        sched.add(job).await?;
    }

    // Job 5: 15-min warning before end of day
    {
        let app = app.clone();
        let cron = format!("0 {} {} * * *", eod2_warn_m, eod2_warn_h);
        let job = Job::new_async(cron.as_str(), move |_, _| {
            let app = app.clone();
            Box::pin(async move {
                let _ = app
                    .notification()
                    .builder()
                    .title("15 min left in afternoon session")
                    .body("Finish up or queue tasks for tomorrow. Almost done for the day!")
                    .show();
                let _ = app.emit("phase-changed", PhaseChangedPayload {
                    phase: "session2_warning".to_string(),
                });
            })
        })?;
        sched.add(job).await?;
    }

    // Job 6: End of day
    {
        let app = app.clone();
        let cron = format!("0 {} {} * * *", eod2_m, eod2_h);
        let job = Job::new_async(cron.as_str(), move |_, _| {
            let app = app.clone();
            Box::pin(async move {
                let _ = app
                    .notification()
                    .builder()
                    .title("Great work today!")
                    .body("Your dev day is done. Generate your daily report to capture your progress.")
                    .show();
                let _ = app.emit("phase-changed", PhaseChangedPayload {
                    phase: "end_of_day".to_string(),
                });
            })
        })?;
        sched.add(job).await?;
    }

    // Suppress unused variable warning — work_days filtering can be wired in future
    let _ = work_days;

    Ok(sched)
}

fn parse_time(t: &str) -> (u32, u32) {
    let parts: Vec<u32> = t.split(':').filter_map(|p| p.parse().ok()).collect();
    let h = parts.first().copied().unwrap_or(9);
    let m = parts.get(1).copied().unwrap_or(0);
    (h, m)
}

fn subtract_minutes(h: u32, m: u32, mins: u32) -> (u32, u32) {
    let total = h * 60 + m;
    let result = if total >= mins {
        total - mins
    } else {
        (total + 24 * 60) - mins
    };
    (result / 60 % 24, result % 60)
}

fn add_minutes(h: u32, m: u32, mins: u32) -> (u32, u32) {
    let total = h * 60 + m + mins;
    (total / 60 % 24, total % 60)
}
