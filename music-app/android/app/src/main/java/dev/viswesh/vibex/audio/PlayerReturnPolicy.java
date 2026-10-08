package dev.viswesh.vibex.audio;

/** Activity routing state, deliberately separate from the playback service. */
public final class PlayerReturnPolicy {
  private boolean stopped, externalFlow, explicit;
  private long version;

  public PlayerReturnPolicy(boolean restoringExternalFlow) {
    externalFlow = restoringExternalFlow;
    version = restoringExternalFlow ? 0 : 1;
  }

  public void stopped() {
    stopped = true;
  }

  public void externalFlowStarted() {
    externalFlow = true;
  }

  public void externalFlowFailed() {
    externalFlow = false;
  }

  public boolean isExternalFlow() {
    return externalFlow;
  }

  public long version() {
    return version;
  }

  public void openFromMediaControl() {
    version++;
    explicit = true;
    externalFlow = false;
  }

  public void resumed() {
    if (stopped && !externalFlow && !explicit) version++;
    stopped = false;
    externalFlow = false;
    explicit = false;
  }
}
