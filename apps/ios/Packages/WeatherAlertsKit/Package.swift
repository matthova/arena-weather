// swift-tools-version: 5.9
import PackageDescription

/// The platform-independent half of the app: the rule JSON (`packages/core`'s schema ported to Swift),
/// the variable catalogue, the draft/validation logic behind the rule builder, forecast helpers and the
/// typed API client. No UI, so iOS, macOS (slice 3) and the tests share it unchanged.
let package = Package(
    name: "WeatherAlertsKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "WeatherAlertsKit", targets: ["WeatherAlertsKit"]),
    ],
    targets: [
        .target(name: "WeatherAlertsKit"),
        .testTarget(name: "WeatherAlertsKitTests", dependencies: ["WeatherAlertsKit"]),
    ]
)
