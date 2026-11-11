// Isolated actual-Goja benchmark. No network, DB, wallet or filesystem APIs are
// exposed to JavaScript. All errors use fixed codes, never private input text.
package main

import (
  "bytes"
  "crypto/sha256"
  "encoding/hex"
  "encoding/json"
  "errors"
  "fmt"
  "io"
  "os"
  "runtime"
  "runtime/debug"
  "time"

  "github.com/dop251/goja"
)

const revision = "v0.0.0-20260906210903-70ad66ec7ce4"
const inputLimit = 16 * 1024 * 1024
const sourceLimit = 128 * 1024
const outputLimit = 262144
var names = []string{"empty","ascii","all_utf16_units","unpaired_surrogates","astral_combining_nul","canonical_edges","checkpoint_envelope","checkpoint_snapshot"}

type input struct { Version int `json:"version"`; Cases []json.RawMessage `json:"cases"` }
type caseHeader struct {
  Name string `json:"name"`; Kind string `json:"kind"`; Value json.RawMessage `json:"value"`
  ExpectedHash string `json:"expectedHash"`; ExpectedCanonicalSHA *string `json:"expectedCanonicalSHA"`
}
func boundedRead(reader io.Reader, limit int64) ([]byte, error) {
  value, err := io.ReadAll(io.LimitReader(reader, limit + 1))
  if err != nil || int64(len(value)) > limit { return nil, errors.New("benchmark_input_bound") }
  return value, nil
}
func strictJSON(value []byte, target interface{}) error {
  decoder := json.NewDecoder(bytes.NewReader(value)); decoder.DisallowUnknownFields()
  if decoder.Decode(target) != nil { return errors.New("benchmark_input_shape") }
  var extra interface{}
  if decoder.Decode(&extra) != io.EOF { return errors.New("benchmark_input_shape") }
  return nil
}
func actualVersion() bool {
  info, ok := debug.ReadBuildInfo(); if !ok || runtime.Version() != "go1.27.1" { return false }
  for _, dep := range info.Deps { if dep.Path == "github.com/dop251/goja" { return dep.Version == revision && dep.Replace == nil } }
  return false
}
func run(source, encoded []byte) ([]byte, error) {
  if len(source) > sourceLimit || len(encoded) > inputLimit { return nil, errors.New("benchmark_input_bound") }
  var data input
  if strictJSON(encoded, &data) != nil || data.Version != 1 || len(data.Cases) != len(names) { return nil, errors.New("benchmark_input_shape") }
  started := time.Now(); deadline := started.Add(90 * time.Second)
  rows := make([]json.RawMessage, 0, len(names))
  for index, raw := range data.Cases {
    var header caseHeader
    if strictJSON(raw, &header) != nil || header.Name != names[index] || (header.Kind != "text" && header.Kind != "canonical") || len(header.Value) == 0 || len(header.ExpectedHash) != 8 { return nil, errors.New("benchmark_input_shape") }
    vm := goja.New()
    vm.Set("__benchNow", func() float64 { return float64(time.Since(started).Nanoseconds()) / 1000000 })
    vm.Set("__benchSHA", func(value string) string { hash := sha256.Sum256([]byte(value)); return hex.EncodeToString(hash[:]) })
    timer := time.AfterFunc(time.Until(deadline), func() { vm.Interrupt("benchmark_deadline") })
    _, err := vm.RunString(string(source))
    if err != nil { timer.Stop(); return nil, errors.New("benchmark_runtime_failed") }
    function, ok := goja.AssertFunction(vm.Get("hashBenchmarkJSON"))
    if !ok { timer.Stop(); return nil, errors.New("benchmark_runtime_failed") }
    result, err := function(goja.Undefined(), vm.ToValue(string(raw))); timer.Stop()
    if err != nil { return nil, errors.New("benchmark_runtime_failed") }
    output := []byte(result.String())
    if len(output) > 16384 || !json.Valid(output) { return nil, errors.New("benchmark_output_bound") }
    rows = append(rows, json.RawMessage(output))
    if time.Now().After(deadline) { return nil, errors.New("benchmark_deadline") }
  }
  report := struct {
    Version int `json:"version"`; State string `json:"state"`; GoVersion string `json:"goVersion"`; GojaRevision string `json:"gojaRevision"`
    Clock string `json:"clock"`; ColdScope string `json:"coldScope"`; WarmRepetitions int `json:"warmRepetitions"`; Cases []json.RawMessage `json:"cases"`
  }{1,"passed",runtime.Version(),revision,"host_monotonic_wall_inside_Goja_no_CPU_claim","fresh_Goja_runtime_per_case; first_function_invocation; excludes_parse_compile_and_no_process_cold_claim",2,rows}
  output, err := json.Marshal(report)
  if err != nil || len(output) > outputLimit { return nil, errors.New("benchmark_output_bound") }
  return output, nil
}
func main() {
  fail := func() { fmt.Fprintln(os.Stdout, `{"version":1,"state":"failed","reason":"benchmark_failed"}`); os.Exit(1) }
  defer func() { if recover() != nil { fail() } }()
  if os.Getenv("GITHUB_ACTIONS") != "true" || os.Getenv("HUB_SHOOTER_FIXTURE") != "benchmark" || os.Getenv("SHOOTER_CHECKPOINT_HASH_BENCHMARK") != "1" || len(os.Args) != 2 || !actualVersion() { fail() }
  file, err := os.Open(os.Args[1]); if err != nil { fail() }
  source, err := boundedRead(file, sourceLimit); file.Close(); if err != nil { fail() }
  encoded, err := boundedRead(os.Stdin, inputLimit); if err != nil { fail() }
  result, err := run(source, encoded); if err != nil { fail() }
  fmt.Fprintln(os.Stdout, string(result))
}
