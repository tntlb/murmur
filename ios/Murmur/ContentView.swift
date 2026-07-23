import SwiftUI

// The app home: wordmark, the dictation surface, settings. The bounce
// status line only proves murmur:// routing until US-107 wires the real
// record-and-return loop.
struct ContentView: View {
    @Binding var route: MurmurRoute?
    @State private var showSettings = false

    var body: some View {
        ZStack {
            NightStudio.ink.ignoresSafeArea()
            VStack(spacing: 0) {
                HStack {
                    Text("murmur")
                        .font(.system(size: 22, weight: .semibold, design: .rounded))
                        .foregroundStyle(NightStudio.text)
                    Spacer()
                    Button {
                        showSettings = true
                    } label: {
                        Image(systemName: "gearshape")
                            .foregroundStyle(NightStudio.text.opacity(0.6))
                            .font(.system(size: 18))
                    }
                    .accessibilityLabel("Open settings")
                }
                .padding(.horizontal, 22)
                .padding(.top, 8)

                if case .dictate(let session) = route {
                    Text("bounce received \(session ?? "no session")")
                        .font(NightStudio.mono(11))
                        .textCase(.uppercase)
                        .foregroundStyle(NightStudio.text.opacity(0.45))
                        .padding(.top, 6)
                }

                DictationView()
            }
        }
        .sheet(isPresented: $showSettings) {
            SettingsView()
        }
        .preferredColorScheme(.dark)
    }
}
