package ca.shiftcircle.api.version;

/**
 * Build information for {@code GET /api/v1/version} (docs/08-deployment.md §8), so a reviewer can
 * tell which build and which rule-set version produced what they are looking at.
 *
 * @param name application name
 * @param version build version, or {@code dev} when running without build info
 * @param buildTime build timestamp, or {@code unknown}
 * @param gitCommit git commit the image was built from, or {@code unknown}
 * @param ruleSetVersion published rule-set version the engine is running
 * @param profiles active Spring profiles, comma separated
 */
public record VersionResponse(
    String name,
    String version,
    String buildTime,
    String gitCommit,
    String ruleSetVersion,
    String profiles) {}
