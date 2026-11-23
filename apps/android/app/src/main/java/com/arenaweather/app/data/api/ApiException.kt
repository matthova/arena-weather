package com.arenaweather.app.data.api

/** An error response from the API (`{ error: { code, message, issues } }`) or from Better Auth (`{ code, message }`). */
class ApiException(
    val status: Int,
    val code: String,
    message: String,
    val issues: String? = null,
) : Exception(message) {
    val isUnauthorized: Boolean get() = status == 401
    val isEmailNotVerified: Boolean get() = code == "EMAIL_NOT_VERIFIED"
}

/** A readable message for any failure a screen may show. */
fun Throwable.userMessage(): String = when (this) {
    is ApiException -> when {
        isUnauthorized -> "Please sign in again"
        else -> message?.takeIf { it.isNotBlank() } ?: "Request failed ($status)"
    }
    is java.net.ConnectException, is java.net.UnknownHostException, is java.net.SocketTimeoutException ->
        "Cannot reach the server (${message ?: "network error"}). Check the server address on the sign-in screen."
    else -> message?.takeIf { it.isNotBlank() } ?: this::class.simpleName.orEmpty()
}
