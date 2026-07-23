import Foundation

// Learned correction pairs, applied deterministically to every fresh
// transcript: case-insensitive, whole-word, matching desktop semantics
// (the boundary class is exactly [A-Za-z0-9_], the JavaScript \w).
// The learning diff itself arrives with US-109.
struct CorrectionPair: Equatable {
    let from: String
    let to: String
    var count: Int = 1
}

enum Corrections {
    static func apply(_ text: String, pairs: [CorrectionPair]) -> String {
        var out = text
        for pair in pairs where !pair.from.isEmpty && !pair.to.isEmpty {
            let escaped = NSRegularExpression.escapedPattern(for: pair.from)
            guard let re = try? NSRegularExpression(
                pattern: "(?<![A-Za-z0-9_])\(escaped)(?![A-Za-z0-9_])",
                options: [.caseInsensitive]
            ) else { continue }
            let range = NSRange(out.startIndex..., in: out)
            out = re.stringByReplacingMatches(
                in: out, range: range,
                withTemplate: NSRegularExpression.escapedTemplate(for: pair.to)
            )
        }
        return out
    }
}
