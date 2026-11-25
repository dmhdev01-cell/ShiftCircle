package ca.shiftcircle.api.proposals;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/** Turns on {@code @Scheduled} for the hourly proposal expiry sweep (nothing else is scheduled). */
@Configuration
@EnableScheduling
class ProposalSchedulingConfig {}
