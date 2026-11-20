#!/usr/bin/perl
# Print every audit code the api writes, one per line.
use strict;
use warnings;

my $newline = chr(10);
my $double = chr(34);
my $single = chr(39);

local $/;
while (<>) {
  my $source = $_;

  # the action: the second argument of the audit helper, including the
  # question mark form that picks one of two codes
  while ($source =~ m/audit[(][^,]+,[[:space:]]*([^,]*)/g) {
    my $argument = $1;
    while ($argument =~ m/[$double]([a-z_]+)[$double]/g) {
      print $1, $newline;
    }
  }

  # the entity type, when the helper takes one as the third argument
  while ($source =~ m/audit[(][^,]+,[^,]+,[[:space:]]*[$double]([a-z_]+)[$double]/g) {
    print $1, $newline;
  }

  # the literals of an audit_event insert
  while ($source =~ m/INSERT INTO audit_event(.*?);/gs) {
    my $statement = $1;
    $statement =~ s/jsonb_build_object[(][^)]*[)]//gs;
    while ($statement =~ m/[$single]([a-z_]+)[$single]/g) {
      print $1, $newline;
    }
  }
}
