package ca.shiftcircle.api.proposals;

import java.util.Map;

/** A proposal request refused for a reason the officer can act on (docs/07 §4.4). */
public class ProposalProblemException extends RuntimeException {

  private final int status;
  private final String slug;
  private final String title;
  private final String detail;
  private final Map<String, Object> extra;

  public ProposalProblemException(
      int status, String slug, String title, String detail, Map<String, Object> extra) {
    super(title);
    this.status = status;
    this.slug = slug;
    this.title = title;
    this.detail = detail;
    this.extra = extra;
  }

  public static ProposalProblemException of(int status, String slug, String title, String detail) {
    return new ProposalProblemException(status, slug, title, detail, Map.of());
  }

  public int status() {
    return status;
  }

  public String slug() {
    return slug;
  }

  public String title() {
    return title;
  }

  public String detail() {
    return detail;
  }

  public Map<String, Object> extra() {
    return extra;
  }
}
