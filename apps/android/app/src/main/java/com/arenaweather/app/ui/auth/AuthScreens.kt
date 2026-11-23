package com.arenaweather.app.ui.auth

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import com.arenaweather.app.AppContainer
import com.arenaweather.app.BuildConfig
import com.arenaweather.app.data.api.ApiException
import com.arenaweather.app.data.api.userMessage
import com.arenaweather.app.ui.components.ErrorCard
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.launch

/** Sign in with e-mail + password (Better Auth), or Google when both the server and this build are configured. */
@Composable
fun SignInScreen(container: AppContainer, onSignUp: () -> Unit, onNeedsVerification: (String) -> Unit, modifier: Modifier = Modifier) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val config by container.config.collectAsState()
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var busy by rememberSaveable { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    var showServer by rememberSaveable { mutableStateOf(false) }
    var server by rememberSaveable { mutableStateOf(container.baseUrl) }

    fun run(block: suspend () -> Unit) {
        busy = true
        error = null
        scope.launch {
            try {
                block()
            } catch (e: ApiException) {
                if (e.isEmailNotVerified) onNeedsVerification(email.trim()) else error = e.userMessage()
            } catch (e: Exception) {
                error = e.userMessage()
            } finally {
                busy = false
            }
        }
    }

    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Sign in", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text("Same account as the web app: your rules and devices are shared.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (error != null) ErrorCard(error!!)
        OutlinedTextField(email, { email = it }, label = { Text("E-mail") }, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
        OutlinedTextField(password, { password = it }, label = { Text("Password") }, singleLine = true, modifier = Modifier.fillMaxWidth(), visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
        Button(
            onClick = { run { container.session.signedIn(container.api.signIn(email.trim(), password)) } },
            enabled = !busy && email.isNotBlank() && password.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) { Text(if (busy) "Signing in…" else "Sign in") }

        val googleReady = config?.googleSignIn == true && BuildConfig.GOOGLE_WEB_CLIENT_ID.isNotBlank()
        if (config?.googleSignIn == true) {
            OutlinedButton(
                enabled = !busy && googleReady,
                modifier = Modifier.fillMaxWidth(),
                onClick = {
                    run {
                        // Credential Manager hands us a Google ID token for the API's web client id;
                        // the API verifies it (POST /api/auth/sign-in/social { provider: "google", idToken }).
                        val option = GetGoogleIdOption.Builder()
                            .setServerClientId(BuildConfig.GOOGLE_WEB_CLIENT_ID)
                            .setFilterByAuthorizedAccounts(false)
                            .build()
                        val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
                        val result = CredentialManager.create(context).getCredential(context, request)
                        val idToken = GoogleIdTokenCredential.createFrom(result.credential.data).idToken
                        container.session.signedIn(container.api.signInWithGoogleIdToken(idToken))
                    }
                },
            ) { Text("Continue with Google") }
            if (!googleReady) Text("Google sign-in needs arena.googleWebClientId in local.properties (see apps/android/README.md).", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        TextButton(onClick = onSignUp) { Text("No account yet? Sign up") }

        Spacer(Modifier.height(8.dp))
        TextButton(onClick = { showServer = !showServer }) { Text(if (showServer) "Hide server settings" else "Server: ${container.baseUrl}") }
        if (showServer) {
            Card {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("API origin", style = MaterialTheme.typography.titleSmall)
                    Text("10.0.2.2 is the emulator's host machine; on a phone use your computer's LAN address or the deployed Worker URL.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    OutlinedTextField(server, { server = it }, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri))
                    Button(onClick = {
                        scope.launch {
                            container.settings.setBaseUrl(server)
                            container.refreshConfig()
                            showServer = false
                        }
                    }) { Text("Save") }
                }
            }
        }
    }
}

@Composable
fun SignUpScreen(container: AppContainer, onDone: (String) -> Unit, onBack: () -> Unit, modifier: Modifier = Modifier) {
    val scope = rememberCoroutineScope()
    val config by container.config.collectAsState()
    var name by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var busy by rememberSaveable { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }

    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Create an account", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        if (error != null) ErrorCard(error!!)
        OutlinedTextField(name, { name = it }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(email, { email = it }, label = { Text("E-mail") }, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
        OutlinedTextField(password, { password = it }, label = { Text("Password (8+ characters)") }, singleLine = true, modifier = Modifier.fillMaxWidth(), visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
        Button(
            enabled = !busy && name.isNotBlank() && email.isNotBlank() && password.length >= 8,
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                busy = true
                error = null
                scope.launch {
                    try {
                        // the verification link ends on the web app; the user then signs in here
                        container.api.signUp(name.trim(), email.trim(), password, callbackURL = config?.let { "${container.webAppUrl()}/sign-in" })
                        onDone(email.trim())
                    } catch (e: Exception) {
                        error = e.userMessage()
                    } finally {
                        busy = false
                    }
                }
            },
        ) { Text(if (busy) "Creating…" else "Sign up") }
        TextButton(onClick = onBack) { Text("Back to sign in") }
    }
}

/** After sign-up (or a sign-in refused with EMAIL_NOT_VERIFIED): resend, and locally show the dev outbox link. */
@Composable
fun CheckEmailScreen(container: AppContainer, email: String, onSignIn: () -> Unit, modifier: Modifier = Modifier) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val config by container.config.collectAsState()
    var note by rememberSaveable { mutableStateOf<String?>(null) }
    var link by rememberSaveable { mutableStateOf<String?>(null) }

    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Confirm your e-mail", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text("We sent a confirmation link to $email. Open it, then come back and sign in.", style = MaterialTheme.typography.bodyLarge)
        if (note != null) Text(note!!, color = MaterialTheme.colorScheme.primary)
        Button(onClick = onSignIn, modifier = Modifier.fillMaxWidth()) { Text("I confirmed it, sign in") }
        OutlinedButton(
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                scope.launch {
                    note = runCatching { container.api.sendVerificationEmail(email, "${container.webAppUrl()}/sign-in") }
                        .fold({ "Sent again." }, { "Could not resend: ${it.userMessage()}" })
                }
            },
        ) { Text("Resend the e-mail") }
        if (config?.devMailbox == true) {
            Card {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Local development", style = MaterialTheme.typography.titleSmall)
                    Text("This API has no mail provider; it keeps the e-mails it would have sent. Fetch the link here.", style = MaterialTheme.typography.bodySmall)
                    OutlinedButton(onClick = {
                        scope.launch {
                            runCatching { container.api.devOutbox(email).messages }
                                .onSuccess { msgs ->
                                    val url = msgs.lastOrNull { it.subject.contains("confirm", ignoreCase = true) }?.let { m -> Regex("https?://\\S+").find(m.text)?.value }
                                    link = url
                                    if (url == null) note = "No verification e-mail for $email in the outbox yet."
                                }
                                .onFailure { note = it.userMessage() }
                        }
                    }) { Text("Fetch the verification link") }
                    if (link != null) {
                        Text(link!!, style = MaterialTheme.typography.bodySmall)
                        Button(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(link))) }) { Text("Open it") }
                    }
                }
            }
        }
    }
}
