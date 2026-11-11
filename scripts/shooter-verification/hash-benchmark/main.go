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
type benchmarkFailure struct { Stage string; Case string; Reason string }
func (failure *benchmarkFailure) Error() string { return "benchmark_failed" }
func failed(stage, name, reason string) error { return &benchmarkFailure{stage,name,reason} }
func invokeFailure(vm *goja.Runtime, err error, name string) error {
  reason := "runtime_failed"
  if exception, ok := err.(*goja.Exception); ok {
    message := exception.Value().ToObject(vm).Get("message")
    if message != nil {
      switch message.String() {
      case "benchmark_parity_fnv": reason = "parity_fnv"
      case "benchmark_parity_canonical": reason = "parity_canonical"
      case "benchmark_parity_serialization": reason = "parity_serialization"
      }
    }
  }
  return failed("invoke", name, reason)
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
  if len(source) > sourceLimit || len(encoded) > inputLimit { return nil, failed("input","none","input_bound") }
  var data input
  if strictJSON(encoded, &data) != nil || data.Version != 1 || len(data.Cases) != len(names) { return nil, failed("input","none","input_shape") }
  started := time.Now(); deadline := started.Add(90 * time.Second)
  rows := make([]json.RawMessage, 0, len(names))
  for index, raw := range data.Cases {
    var header caseHeader
    if strictJSON(raw, &header) != nil || header.Name != names[index] || (header.Kind != "text" && header.Kind != "canonical") || len(header.Value) == 0 || len(header.ExpectedHash) != 8 { return nil, failed("input",names[index],"input_shape") }
    vm := goja.New()
    vm.Set("__benchNow", func() float64 { return float64(time.Since(started).Nanoseconds()) / 1000000 })
    vm.Set("__benchSHA", func(value string) string { hash := sha256.Sum256([]byte(value)); return hex.EncodeToString(hash[:]) })
    timer := time.AfterFunc(time.Until(deadline), func() { vm.Interrupt("benchmark_deadline") })
    _, err := vm.RunString(string(source))
    if err != nil { timer.Stop(); return nil, failed("compile",names[index],"runtime_failed") }
    function, ok := goja.AssertFunction(vm.Get("hashBenchmarkJSON"))
    if !ok { timer.Stop(); return nil, failed("compile",names[index],"runtime_failed") }
    result, err := function(goja.Undefined(), vm.ToValue(string(raw))); timer.Stop()
    if err != nil {
      if time.Now().After(deadline) { return nil, failed("deadline",names[index],"deadline") }
      return nil, invokeFailure(vm,err,names[index])
    }
    output := []byte(result.String())
    if len(output) > 16384 || !json.Valid(output) { return nil, failed("output",names[index],"output_bound") }
    rows = append(rows, json.RawMessage(output))
    if time.Now().After(deadline) { return nil, failed("deadline",names[index],"deadline") }
  }
  report := struct {
    Version int `json:"version"`; State string `json:"state"`; GoVersion string `json:"goVersion"`; GojaRevision string `json:"gojaRevision"`
    Clock string `json:"clock"`; ColdScope string `json:"coldScope"`; WarmRepetitions int `json:"warmRepetitions"`; Cases []json.RawMessage `json:"cases"`
  }{1,"passed",runtime.Version(),revision,"host_monotonic_wall_inside_Goja_no_CPU_claim","fresh_Goja_runtime_per_case; first_function_invocation; excludes_parse_compile_and_no_process_cold_claim",2,rows}
  output, err := json.Marshal(report)
  if err != nil || len(output) > outputLimit { return nil, failed("output","none","output_bound") }
  return output, nil
}
func main() {
  fail := func(stage, name, reason string) {
    value := struct { Version int `json:"version"`; State string `json:"state"`; Stage string `json:"stage"`; Case string `json:"case"`; Reason string `json:"reason"` }{1,"failed",stage,name,reason}
    encoded, _ := json.Marshal(value); fmt.Fprintln(os.Stdout,string(encoded)); os.Exit(1)
  }
  defer func() { if recover() != nil { fail("output","none","panic") } }()
  if os.Getenv("GITHUB_ACTIONS") != "true" || os.Getenv("HUB_SHOOTER_FIXTURE") != "benchmark" || os.Getenv("SHOOTER_CHECKPOINT_HASH_BENCHMARK") != "1" || len(os.Args) != 2 { fail("gate","none","refused") }
  if !actualVersion() { fail("gate","none","version_refused") }
  file, err := os.Open(os.Args[1]); if err != nil { fail("input","none","input_bound") }
  source, err := boundedRead(file, sourceLimit); file.Close(); if err != nil { fail("input","none","input_bound") }
  encoded, err := boundedRead(os.Stdin, inputLimit); if err != nil { fail("input","none","input_bound") }
  result, err := run(source, encoded); if err != nil {
    if known, ok := err.(*benchmarkFailure); ok { fail(known.Stage,known.Case,known.Reason) }
    fail("output","none","runtime_failed")
  }
  fmt.Fprintln(os.Stdout, string(result))
}
