package com.audiobookshelf.app.player

/**
 * Pure decision logic for audio-focus interruptions (phone calls, ringtones, notification
 * sounds). Has no dependency on AudioManager/Player/Context so it can be exercised directly in a
 * host-JVM test; [PlayerNotificationService] owns the AudioManager registration and applies
 * whatever action each method returns.
 */
class AudioInterruptionPolicy {
  var resumeAfterFocus = false
    private set
  var soughtBackForInterruption = false
    private set

  /** What a caller should do in response to a focus event. */
  data class InterruptionAction(val seekBackMs: Long = 0L, val pause: Boolean = false) {
    companion object {
      val NONE = InterruptionAction()
    }
  }

  data class FocusGainAction(val restoreVolume: Boolean = true, val resume: Boolean = false)

  /**
   * Full, indefinite focus loss - a phone call or VoIP call taking over audio. Seeks back 10s
   * once per interruption: immediately if playback was active, or from the current position if
   * playback was already paused by a preceding transient loss (the ringtone), never twice.
   */
  fun onFocusLoss(isPlaying: Boolean): InterruptionAction {
    val action =
            when {
              isPlaying -> InterruptionAction(seekBackMs = 10_000L, pause = true)
              !soughtBackForInterruption -> InterruptionAction(seekBackMs = 10_000L)
              else -> InterruptionAction.NONE
            }
    resumeAfterFocus = false
    soughtBackForInterruption = true
    return action
  }

  /** Transient loss - ringtone, assistant. Pause and remember to resume when focus returns. */
  fun onFocusLossTransient(isPlaying: Boolean): InterruptionAction {
    if (!isPlaying) return InterruptionAction.NONE
    resumeAfterFocus = true
    return InterruptionAction(pause = true)
  }

  /**
   * Duckable loss - a notification sound. Seeks back 1s (short interruptions still cause the
   * listener to miss a beat), pauses, and remembers to resume when focus returns.
   */
  fun onFocusLossTransientCanDuck(isPlaying: Boolean): InterruptionAction {
    if (!isPlaying) return InterruptionAction.NONE
    resumeAfterFocus = true
    return InterruptionAction(seekBackMs = 1_000L, pause = true)
  }

  fun onFocusGain(): FocusGainAction {
    val shouldResume = resumeAfterFocus
    resumeAfterFocus = false
    return FocusGainAction(restoreVolume = true, resume = shouldResume)
  }

  /**
   * A manual/explicit pause always wins over a pending auto-resume: if the user paused during an
   * interruption (e.g. right after a ringtone paused playback, before the call is even
   * answered), focus returning later must not resume playback they deliberately stopped.
   */
  fun onManualPause() {
    resumeAfterFocus = false
  }

  /**
   * Consumes the "already sought back for this interruption" flag so [PlayerListener]'s
   * pause-duration auto-rewind does not rewind a second time on top of [onFocusLoss]'s seek-back.
   */
  fun consumeSoughtBackForInterruption(): Boolean {
    val value = soughtBackForInterruption
    soughtBackForInterruption = false
    return value
  }
}
