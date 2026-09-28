//! Manufacturer-neutral error type for machine communication.
//!
//! Every backend (Brother, and future Janome/Bernina/... implementations)
//! translates its transport- and protocol-level failures into this enum so
//! that the localhost API can map them to stable, structured JSON errors
//! without knowing anything about the underlying protocol.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum MachineError {
    #[error("Ember Link is busy with another transfer or firmware update")]
    Busy,
    #[error("Delivery could not be confirmed. Check the file on the device before sending again.")]
    DeliveryUnknown,
    #[error("The device identity changed. Scan again and select the intended machine.")]
    IdentityChanged,
    #[error("This device does not support that operation")]
    UnsupportedOperation,
    #[error("A file with this name exists. Confirm replacement before sending.")]
    FileExists,
    /// TCP/TLS level failure: host down, wrong IP, connection refused.
    #[error("machine unreachable: {0}")]
    Unreachable(String),

    /// The request was sent but the machine did not answer in time.
    #[error("request to machine timed out")]
    Timeout,

    /// The machine answered, but not in the shape the protocol expects.
    #[error("protocol error: {0}")]
    Protocol(String),

    /// The machine understood the request and explicitly rejected it
    /// (e.g. a non-zero `error_code` in a Brother pedxml response).
    #[error("machine rejected the request (machine error code {code})")]
    Rejected { code: i64 },

    /// The design exceeds the machine's maximum accepted file size.
    #[error("design is {size} bytes but the machine accepts at most {limit} bytes")]
    FileTooLarge { size: u64, limit: u64 },

    /// The design fits the size limit but the machine's memory is too full.
    #[error("not enough free memory on the machine: design is {size} bytes, {free} bytes free")]
    InsufficientStorage { size: u64, free: u64 },

    /// The file extension is not one this machine can load.
    #[error("unsupported design format {format:?}; this machine accepts {supported}")]
    UnsupportedFormat { format: String, supported: String },

    /// The upload completed at the HTTP level but with an unexpected status.
    #[error("upload rejected with HTTP status {0}")]
    UploadFailed(u16),

    /// The machine requires this computer to pair first and refused our
    /// attempt; the hint tells the user what to do at the machine.
    #[error("machine requires pairing: {hint}")]
    PairingRequired { hint: String },
}

impl MachineError {
    /// Stable machine-readable error code exposed by the localhost API.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Busy => "device_busy",
            Self::DeliveryUnknown => "delivery_unknown",
            Self::IdentityChanged => "identity_changed",
            Self::UnsupportedOperation => "unsupported_operation",
            Self::FileExists => "file_exists",
            MachineError::Unreachable(_) => "machine_unreachable",
            MachineError::Timeout => "machine_timeout",
            MachineError::Protocol(_) => "protocol_error",
            MachineError::Rejected { .. } => "machine_rejected",
            MachineError::FileTooLarge { .. } => "file_too_large",
            MachineError::InsufficientStorage { .. } => "insufficient_storage",
            MachineError::UnsupportedFormat { .. } => "unsupported_format",
            MachineError::UploadFailed(_) => "upload_failed",
            MachineError::PairingRequired { .. } => "pairing_required",
        }
    }
}
