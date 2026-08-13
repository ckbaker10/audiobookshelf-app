package com.audiobookshelf.app.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class AudioInterruptionPolicyTest {
  private lateinit var policy: AudioInterruptionPolicy

  @Before
  fun setUp() {
    policy = AudioInterruptionPolicy()
  }

  @Test
  fun `a call during active playback seeks back 10s and pauses`() {
    val action = policy.onFocusLoss(isPlaying = true)

    assertEquals(10_000L, action.seekBackMs)
    assertTrue(action.pause)
  }

  @Test
  fun `a call while already paused by a ringtone seeks back once and does not pause again`() {
    // The ringtone's transient loss already paused playback and sought back nothing itself;
    // the call escalates to a full loss while still paused.
    policy.onFocusLossTransient(isPlaying = true)

    val action = policy.onFocusLoss(isPlaying = false)

    assertEquals(10_000L, action.seekBackMs)
    assertFalse(action.pause)
  }

  @Test
  fun `a second full loss while still paused does not seek back twice`() {
    policy.onFocusLoss(isPlaying = true)

    val secondAction = policy.onFocusLoss(isPlaying = false)

    assertEquals(AudioInterruptionPolicy.InterruptionAction.NONE, secondAction)
  }

  @Test
  fun `a transient loss while playing pauses and remembers to resume`() {
    val action = policy.onFocusLossTransient(isPlaying = true)

    assertEquals(0L, action.seekBackMs)
    assertTrue(action.pause)
    assertTrue(policy.resumeAfterFocus)
  }

  @Test
  fun `a transient loss while already paused is a no-op`() {
    val action = policy.onFocusLossTransient(isPlaying = false)

    assertEquals(AudioInterruptionPolicy.InterruptionAction.NONE, action)
    assertFalse(policy.resumeAfterFocus)
  }

  @Test
  fun `a duckable loss seeks back 1s, pauses, and remembers to resume`() {
    val action = policy.onFocusLossTransientCanDuck(isPlaying = true)

    assertEquals(1_000L, action.seekBackMs)
    assertTrue(action.pause)
    assertTrue(policy.resumeAfterFocus)
  }

  @Test
  fun `focus gain after a transient loss restores volume and resumes`() {
    policy.onFocusLossTransient(isPlaying = true)

    val gainAction = policy.onFocusGain()

    assertTrue(gainAction.restoreVolume)
    assertTrue(gainAction.resume)
    assertFalse(policy.resumeAfterFocus)
  }

  @Test
  fun `focus gain after a full call loss restores volume but does not resume`() {
    // A phone call always pauses explicitly and never auto-resumes - the user answers or
    // declines and must tap play themselves.
    policy.onFocusLoss(isPlaying = true)

    val gainAction = policy.onFocusGain()

    assertTrue(gainAction.restoreVolume)
    assertFalse(gainAction.resume)
  }

  @Test
  fun `a manual pause during a pending auto-resume cancels the resume`() {
    policy.onFocusLossTransient(isPlaying = true)
    assertTrue(policy.resumeAfterFocus)

    policy.onManualPause()

    assertFalse(policy.resumeAfterFocus)
    val gainAction = policy.onFocusGain()
    assertFalse(gainAction.resume)
  }

  @Test
  fun `consumeSoughtBackForInterruption reads and clears the flag exactly once`() {
    policy.onFocusLoss(isPlaying = true)

    assertTrue(policy.consumeSoughtBackForInterruption())
    assertFalse(policy.consumeSoughtBackForInterruption())
  }

  @Test
  fun `soughtBackForInterruption is false before any interruption`() {
    assertFalse(policy.consumeSoughtBackForInterruption())
  }
}
