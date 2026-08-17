import CoreGraphics
import Foundation

// Non-prompting TCC checks (CGPreflight* APIs never trigger the macOS prompt).
let screenRecording = CGPreflightScreenCaptureAccess()
print("screen_recording=\(screenRecording ? "granted" : "denied")")
