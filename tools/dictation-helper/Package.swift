// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "dictation-helper",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/FluidInference/FluidAudio.git", exact: "0.17.1")
    ],
    targets: [
        .executableTarget(
            name: "dictate",
            dependencies: [.product(name: "FluidAudio", package: "FluidAudio")],
            path: "Sources/dictate"
        )
    ]
)
