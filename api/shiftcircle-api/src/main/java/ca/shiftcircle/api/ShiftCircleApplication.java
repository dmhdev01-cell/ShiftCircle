package ca.shiftcircle.api;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/** ShiftCircle API entry point. */
@SpringBootApplication(scanBasePackages = "ca.shiftcircle")
public class ShiftCircleApplication {

  public static void main(String[] args) {
    SpringApplication.run(ShiftCircleApplication.class, args);
  }
}
