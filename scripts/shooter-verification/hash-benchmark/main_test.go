package main

import (
  "bytes"
  "testing"
)

func TestBoundedIO(t *testing.T) {
  if _, err := boundedRead(bytes.NewReader([]byte("12345")), 4); err == nil { t.Fatal("missing input bound") }
  if data, err := boundedRead(bytes.NewReader([]byte("1234")), 4); err != nil || len(data) != 4 { t.Fatal("exact bound rejected") }
}
func TestStrictInput(t *testing.T) {
  for _, data := range []string{`{"version":1,"cases":[],"secret":"private"}`, `{"version":1,"cases":[]} {}`, `[]`} {
    if _, err := run([]byte(""), []byte(data)); err == nil { t.Fatal("malformed input accepted") }
  }
  if _, err := run(bytes.Repeat([]byte(" "), sourceLimit + 1), []byte(`{}`)); err == nil { t.Fatal("source bound missing") }
}
