package ca.shiftcircle.infrastructure.demo;

import java.util.List;

/**
 * Fictional names only (HANDOFF §5 guardrail 1). The ten named demo characters match the UI design
 * and are created first with fixed employee numbers; everyone else is drawn from the fixed lists.
 */
public final class DemoNames {

  public static final List<String> FIRST_NAMES =
      List.of(
          "Tara", "Nia", "Ruth", "Marc", "Kari", "Sam", "Piotr", "Leah", "Devon", "Aiden",
          "Amara", "Bennett", "Carmen", "Dalen", "Elena", "Farah", "Gideon", "Hana", "Isaac",
          "Jolene", "Kellan", "Lena", "Mateo", "Noor", "Owen", "Priya", "Quinn", "Rhea", "Soren",
          "Tessa", "Ulric", "Vera", "Wade", "Xenia", "Yusuf", "Zara", "Alina", "Bram", "Cato",
          "Della", "Emeka", "Fiona", "Greta", "Hal", "Imani", "Jonas", "Kira", "Lars", "Mira",
          "Nell", "Omar", "Pia", "Rafael", "Sana", "Tobin", "Uma", "Vince", "Willa", "Yara",
          "Zeke");

  public static final List<String> LAST_NAMES =
      List.of(
          "Nakamura", "Thompson", "Okafor", "Desjardins", "Lindqvist", "Abara", "Kowalczyk",
          "Morin", "Clarke", "Bergeron", "Adeyemi", "Bouchard", "Chen", "Dubois", "Eriksen",
          "Fontaine", "Gagnon", "Haddad", "Ibrahim", "Jensen", "Kaur", "Lavoie", "Mackenzie",
          "Nguyen", "Olsen", "Park", "Quist", "Rasmussen", "Singh", "Tremblay", "Uddin", "Varga",
          "Walsh", "Xu", "Yilmaz", "Zimmer", "Andersen", "Beaulieu", "Cardinal", "Dahl", "Evans",
          "Fischer", "Girard", "Holm", "Iqbal", "Jourdain", "Keller", "Larsen", "Moreau", "Nyberg",
          "Osei", "Pelletier", "Roy", "Sorensen", "Tessier", "Upton", "Voss", "Webb", "Young", "Zola");

  /** The ten named characters: employee number, first, last, home unit code. */
  public static final List<Named> NAMED =
      List.of(
          new Named("E-001", "Tara", "Nakamura", "B"),
          new Named("E-002", "Nia", "Thompson", "B"),
          new Named("E-003", "Ruth", "Okafor", "A"),
          new Named("E-004", "Marc", "Desjardins", "A"),
          new Named("E-005", "Kari", "Lindqvist", "C"),
          new Named("E-006", "Sam", "Abara", "C"),
          new Named("E-007", "Piotr", "Kowalczyk", "CTL"),
          new Named("E-008", "Leah", "Morin", "ADM"),
          new Named("E-009", "Devon", "Clarke", "ESC"),
          new Named("E-010", "Aiden", "Bergeron", "B"));

  public record Named(String employeeNo, String firstName, String lastName, String unitCode) {}

  private DemoNames() {}
}
