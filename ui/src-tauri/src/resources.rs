//! Sample off the UI thread. Include detached daemon descendants as well as the desktop tree.
use std::{collections::{HashMap, HashSet}, sync::{Arc, Mutex}, time::Duration};
use serde::Serialize;
use sysinfo::{Pid, System};
use tauri::State;

#[derive(Clone, Serialize)]
pub struct ProcessUsage { pid: u32, name: String, cpu: f32, memory: u64 }
#[derive(Clone, Serialize)]
pub struct Snapshot {
    cpu: f32, memory: u64, total_memory: u64, swap: u64,
    app_cpu: f32, app_memory: u64, cores: usize, processes: Vec<ProcessUsage>,
}
#[derive(Default, Clone)]
pub struct Resources(Arc<Mutex<Option<Snapshot>>>);

fn descendants(parents: &HashMap<u32, Option<u32>>, roots: &[u32]) -> HashSet<u32> {
    let mut selected: HashSet<u32> = roots.iter().copied().filter(|p| *p > 0).collect();
    loop {
        let before = selected.len();
        for (&pid, parent) in parents {
            if parent.is_some_and(|p| selected.contains(&p)) { selected.insert(pid); }
        }
        if selected.len() == before { return selected; }
    }
}

impl Resources {
    pub fn start(&self) {
        let state = self.clone();
        std::thread::spawn(move || {
            let mut system = System::new_all();
            loop {
                // CPU usage needs two samples; don't show the initial zero as a measurement.
                std::thread::sleep(Duration::from_secs(3));
                system.refresh_all();
                let mut roots = vec![std::process::id()];
                let daemon = crate::service::status(&crate::service::state_dir());
                if let Some(process) = system.process(Pid::from_u32(daemon.pid)) {
                    // Busy agents can outlive the heartbeat freshness window. Match start time
                    // too, so a recycled PID never counts an unrelated process as our daemon.
                    if daemon.pid > 0 && (process.start_time() as f64 - daemon.started_at).abs() < 60.0 {
                        roots.push(daemon.pid);
                    }
                }
                let parents = system.processes().iter().map(|(pid, p)| (pid.as_u32(), p.parent().map(|p| p.as_u32()))).collect();
                let selected = descendants(&parents, &roots);
                let cores = system.cpus().len().max(1);
                let mut processes: Vec<_> = system.processes().iter().filter(|(pid, _)| selected.contains(&pid.as_u32()))
                    .map(|(pid, p)| ProcessUsage { pid: pid.as_u32(), name: p.name().to_string_lossy().into_owned(),
                        cpu: p.cpu_usage() / cores as f32, memory: p.memory() }).collect();
                processes.sort_by_key(|p| std::cmp::Reverse(p.memory));
                let snapshot = Snapshot { cpu: system.global_cpu_usage(), memory: system.used_memory(),
                    total_memory: system.total_memory(), swap: system.used_swap(),
                    app_cpu: processes.iter().map(|p| p.cpu).sum(), app_memory: processes.iter().map(|p| p.memory).sum(),
                    cores, processes };
                *state.0.lock().unwrap() = Some(snapshot);
            }
        });
    }
}
#[tauri::command]
pub fn resource_usage(state: State<'_, Resources>) -> Option<Snapshot> { state.0.lock().unwrap().clone() }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn includes_detached_daemon_tree_without_unrelated_processes() {
        let parents = HashMap::from([(1, None), (10, Some(1)), (20, Some(1)), (21, Some(20)), (22, Some(21)), (99, Some(1))]);
        assert_eq!(descendants(&parents, &[10, 20]), HashSet::from([10, 20, 21, 22]));
    }
    #[test]
    fn missing_roots_and_cycles_do_not_loop() {
        assert_eq!(descendants(&HashMap::from([(3, Some(4)), (4, Some(3))]), &[0, 10]), HashSet::from([10]));
    }
}
