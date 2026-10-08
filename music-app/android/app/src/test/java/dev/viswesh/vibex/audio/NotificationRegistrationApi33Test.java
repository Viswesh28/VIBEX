package dev.viswesh.vibex.audio;

import org.robolectric.annotation.Config;

/** Separate fork keeps the Android 9 and Android 13 framework images out of the same small JVM. */
@Config(sdk = 33)
public class NotificationRegistrationApi33Test extends NotificationRegistrationTest {}
