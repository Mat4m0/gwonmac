//! Correlates the native login request with its queued and processed completion.
//! It grants only a private generation token; friend fields remain owned by the
//! bounded reader, and any lifecycle contradiction permanently refuses the token.

static mut EPOCH: u32 = 0;
static mut QUEUED_COMPLETIONS: u32 = 0;
static mut PROCESSED_COMPLETIONS: u32 = 0;
static mut REQUEST_EPOCH: u32 = 0;
static mut REQUEST_ID: u32 = 0;
static mut REQUEST_CONNECTION: u32 = 0;
static mut COMPLETION_START: u32 = 0;
static mut COMPLETION_STARTED: bool = false;
static mut EXPECTED_COMPLETION: u32 = 0;
static mut EXPECTED_EPOCH: u32 = 0;
static mut READY_EPOCH: u32 = 0;

pub(crate) unsafe fn initialize() {
    unsafe {
        EPOCH = 1;
        QUEUED_COMPLETIONS = 0;
        PROCESSED_COMPLETIONS = 0;
        clear_request();
        READY_EPOCH = 0;
    }
}

unsafe fn clear_request() {
    unsafe {
        REQUEST_EPOCH = 0;
        REQUEST_ID = 0;
        REQUEST_CONNECTION = 0;
        COMPLETION_START = 0;
        COMPLETION_STARTED = false;
        EXPECTED_COMPLETION = 0;
        EXPECTED_EPOCH = 0;
    }
}

unsafe fn terminate() {
    unsafe {
        EPOCH = 0;
        clear_request();
        READY_EPOCH = 0;
    }
}

/// Withdraw the accepted session before the native lifecycle transition runs.
pub(crate) unsafe fn invalidate() {
    unsafe {
        if EPOCH == 0 {
            return;
        }
        let Some(next) = EPOCH.checked_add(1) else {
            terminate();
            return;
        };
        EPOCH = next;
        clear_request();
        READY_EPOCH = 0;
    }
}

/// Record the one login request after the native sender captured its connection.
pub(crate) unsafe fn request_sent(request_id: u32, connection: u32) {
    unsafe {
        clear_request();
        READY_EPOCH = 0;
        if EPOCH == 0 || request_id == 0 || connection == 0 {
            return;
        }
        REQUEST_EPOCH = EPOCH;
        REQUEST_ID = request_id;
        REQUEST_CONNECTION = connection;
    }
}

/// Start observing the completion callback before it enqueues event 14.
pub(crate) unsafe fn completion_started(request_id: u32, connection: u32, success: bool) {
    unsafe {
        COMPLETION_STARTED = false;
        if !success
            || EPOCH == 0
            || REQUEST_EPOCH != EPOCH
            || REQUEST_ID != request_id
            || REQUEST_CONNECTION != connection
        {
            if REQUEST_ID == request_id {
                clear_request();
                READY_EPOCH = 0;
            }
            return;
        }
        COMPLETION_START = QUEUED_COMPLETIONS;
        COMPLETION_STARTED = true;
    }
}

/// Count event 14 only after the native queue accepted it for the Friends context.
pub(crate) unsafe fn completion_queued() {
    unsafe {
        if EPOCH == 0 {
            return;
        }
        let Some(next) = QUEUED_COMPLETIONS.checked_add(1) else {
            terminate();
            return;
        };
        QUEUED_COMPLETIONS = next;
    }
}

/// Arm the exact queue ordinal produced during the matching completion callback.
pub(crate) unsafe fn completion_finished() {
    unsafe {
        if EPOCH == 0 || !COMPLETION_STARTED {
            return;
        }
        COMPLETION_STARTED = false;
        let Some(expected) = COMPLETION_START.checked_add(1) else {
            terminate();
            return;
        };
        if QUEUED_COMPLETIONS != expected {
            clear_request();
            return;
        }
        EXPECTED_COMPLETION = expected;
        EXPECTED_EPOCH = EPOCH;
        REQUEST_EPOCH = 0;
        REQUEST_ID = 0;
        REQUEST_CONNECTION = 0;
    }
}

/// Advance only after the native Friends callback has returned for event 14.
pub(crate) unsafe fn completion_processed() {
    unsafe {
        if EPOCH == 0 {
            return;
        }
        let Some(next) = PROCESSED_COMPLETIONS.checked_add(1) else {
            terminate();
            return;
        };
        if next > QUEUED_COMPLETIONS {
            terminate();
            return;
        }
        PROCESSED_COMPLETIONS = next;
        if next == EXPECTED_COMPLETION && EXPECTED_EPOCH == EPOCH {
            READY_EPOCH = EPOCH;
            EXPECTED_COMPLETION = 0;
            EXPECTED_EPOCH = 0;
        }
    }
}

pub(crate) unsafe fn accepted_generation() -> u32 {
    unsafe {
        if READY_EPOCH != 0 && READY_EPOCH == EPOCH {
            READY_EPOCH
        } else {
            0
        }
    }
}
