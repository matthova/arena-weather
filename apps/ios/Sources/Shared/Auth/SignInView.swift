import SwiftUI
import WeatherAlertsKit

/// E-mail + password sign-in (Better Auth), Google when the server has it, link to sign-up.
struct SignInView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?
    @State private var unverified = false
    @State private var signingUp = false

    var body: some View {
        Form {
            Section {
                TextField("E-mail", text: $email)
                    .textContentType(.username)
                    .emailField()
                SecureField("Password", text: $password)
                    .textContentType(.password)
                    .onSubmit { Task { await signIn() } }
            }
            if unverified {
                Section {
                    NavigationLink {
                        CheckEmailView(email: email, password: password)
                    } label: {
                        Label("E-mail not confirmed yet — confirmation steps", systemImage: "envelope.badge")
                            .foregroundStyle(.orange)
                    }
                }
            }
            Section {
                Button {
                    Task { await signIn() }
                } label: {
                    HStack { Text("Sign in"); Spacer(); if busy { ProgressView() } }
                }
                .disabled(busy || email.isEmpty || password.isEmpty)
            }
            if model.config?.googleSignIn == true {
                Section {
                    Button {
                        Task { await signInWithGoogle() }
                    } label: {
                        Label("Continue with Google", systemImage: "globe")
                    }
                    .disabled(busy)
                } footer: {
                    Text("Opens a browser sheet; the session comes back to the app through its weatheralerts:// link.")
                }
            }
            Section {
                Button("Create an account") { signingUp = true }
            } footer: {
                Text("Same account as the web app. Server: \(model.serverURL.absoluteString) (change it under Account).")
            }
        }
        .navigationTitle("Sign in")
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        }
        .sheet(isPresented: $signingUp) {
            NavigationStack { SignUpView() }
        }
        .onChange(of: model.isSignedIn) { _, signedIn in
            if signedIn { dismiss() }
        }
        .errorAlert($error)
    }

    private func signIn() async {
        busy = true
        defer { busy = false }
        unverified = false
        do {
            try await model.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password)
        } catch let apiError as APIError where apiError.isEmailNotVerified {
            unverified = true
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func signInWithGoogle() async {
        busy = true
        defer { busy = false }
        do {
            #if canImport(AuthenticationServices)
            try await model.signInWithGoogle(using: WebAuthenticator())
            #else
            throw APIError(status: 0, code: "unsupported", message: "Google sign-in is not available on this platform")
            #endif
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct SignUpView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?
    @State private var created = false

    var body: some View {
        Form {
            Section {
                TextField("Name", text: $name).textContentType(.name)
                TextField("E-mail", text: $email).textContentType(.username).emailField()
                SecureField("Password (8+ characters)", text: $password).textContentType(.newPassword)
            }
            Section {
                Button {
                    Task { await signUp() }
                } label: {
                    HStack { Text("Create account"); Spacer(); if busy { ProgressView() } }
                }
                .disabled(busy || name.isEmpty || email.isEmpty || password.count < 8)
            } footer: {
                Text("You will get an e-mail with a confirmation link; sign-in works once it was opened.")
            }
        }
        .navigationTitle("Create account")
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        }
        .navigationDestination(isPresented: $created) {
            CheckEmailView(email: email, password: password)
        }
        .onChange(of: model.isSignedIn) { _, signedIn in
            if signedIn { dismiss() }
        }
        .errorAlert($error)
    }

    private func signUp() async {
        busy = true
        defer { busy = false }
        do {
            try await model.signUp(name: name.trimmingCharacters(in: .whitespaces), email: email.trimmingCharacters(in: .whitespaces), password: password)
            created = true
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// After sign-up: resend the e-mail, and in local development fetch the link from the API's dev outbox.
struct CheckEmailView: View {
    @Environment(AppModel.self) private var model
    let email: String
    let password: String

    @State private var busy = false
    @State private var status: String?
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                Text("We sent a confirmation link to **\(email)**. Open it, then sign in.")
            }
            Section {
                Button("Resend the e-mail") { Task { await resend() } }.disabled(busy)
                Button("I confirmed it — sign me in") { Task { await trySignIn() } }.disabled(busy)
            }
            if model.config?.devMailbox == true {
                Section {
                    Button {
                        Task { await verifyFromDevOutbox() }
                    } label: {
                        HStack { Label("Confirm from the dev outbox", systemImage: "tray.and.arrow.down"); Spacer(); if busy { ProgressView() } }
                    }
                    .disabled(busy)
                } header: {
                    Text("Local development")
                } footer: {
                    Text("This API has no mail provider: it keeps the e-mails it would have sent. This opens the link for you and signs you in.")
                }
            }
            if let status {
                Section { Text(status).font(.footnote) }
            }
        }
        .navigationTitle("Confirm your e-mail")
        .errorAlert($error)
    }

    private func resend() async {
        busy = true
        defer { busy = false }
        do {
            try await model.api.sendVerificationEmail(email: email)
            status = "Sent again."
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func trySignIn() async {
        busy = true
        defer { busy = false }
        do {
            try await model.signIn(email: email, password: password)
        } catch let apiError as APIError where apiError.isEmailNotVerified {
            status = "Still not confirmed. Open the link in the e-mail first."
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func verifyFromDevOutbox() async {
        busy = true
        defer { busy = false }
        do {
            let messages = try await model.api.devOutbox(to: email)
            guard let link = messages.first(where: { $0.firstLink != nil })?.firstLink else {
                status = "No e-mail for \(email) in the outbox yet. Try “Resend”."
                return
            }
            try await model.api.openVerificationLink(link)
            status = "Confirmed. Signing in…"
            try await model.signIn(email: email, password: password)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

extension View {
    @ViewBuilder
    func emailField() -> some View {
        #if os(iOS)
        self.keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
        #else
        self.autocorrectionDisabled()
        #endif
    }
}
