import Foundation
import FluidAudio

// Quinki dictation helper: trascrizione locale con Parakeet TDT v3 (FluidAudio,
// CoreML/Apple Neural Engine). Stampa SOLO il testo su stdout.
// I modelli vivono in ~/.quinki/models/fluid-audio (scaricati al primo uso, ~473MB).
//
// usage: dictate transcribe <file audio>   |   dictate download   |   dictate status

@main
struct DictationHelper {
    static func main() async {
        let args = CommandLine.arguments
        let home = FileManager.default.homeDirectoryForCurrentUser
        let modelsDir = home.appendingPathComponent(".quinki/models/fluid-audio", isDirectory: true)
        try? FileManager.default.createDirectory(at: modelsDir, withIntermediateDirectories: true)

        guard args.count >= 2 else {
            FileHandle.standardError.write(Data("usage: dictate transcribe <file> | dictate download | dictate status\n".utf8))
            exit(2)
        }

        do {
            switch args[1] {
            case "status":
                // Il modello e' presente? (cartella non vuota)
                let p = modelsDir.appendingPathComponent("parakeet-tdt-0.6b-v3")
                let ok = FileManager.default.fileExists(atPath: p.path)
                print(ok ? "ready" : "missing")
                return
            case "download":
                _ = try await AsrModels.downloadAndLoad(to: modelsDir, version: .v3)
                print("OK")
                return
            case "transcribe":
                guard args.count >= 3 else {
                    FileHandle.standardError.write(Data("usage: dictate transcribe <file>\n".utf8))
                    exit(2)
                }
                let models = try await AsrModels.downloadAndLoad(to: modelsDir, version: .v3)
                let manager = AsrManager(config: .default)
                try await manager.loadModels(models)
                var state = try TdtDecoderState()
                let result = try await manager.transcribe(URL(fileURLWithPath: args[2]), decoderState: &state, language: nil)
                print(result.text)
                return
            default:
                FileHandle.standardError.write(Data("unknown command\n".utf8))
                exit(2)
            }
        } catch {
            FileHandle.standardError.write(Data("error: \(error)\n".utf8))
            exit(1)
        }
    }
}
