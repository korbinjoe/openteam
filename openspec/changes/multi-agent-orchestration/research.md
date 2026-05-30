# Multi-Agent Orchestration Research Analysis

## 1. Research Scope

Source code analysis of three major open-source multi-agent frameworks, plus
OpenTeam's existing orchestration model. Goal: identify orchestration primitives,
execution models, and coordination patterns to inform OpenTeam's evolution.

| Framework | Source Path | Version |
|-----------|-----------|---------|
| LangGraph | `~/work/langgraph/` | Core graph runtime + multi-agent extensions |
| crewAI | `~/work/crewAI/` | Process/Flow dual-layer orchestration |
| langgraph-supervisor | `~/work/langgraph-supervisor-py/` | Thin supervisor wrapper over LangGraph |
| OpenTeam (current) | `./` | Lead + Expert subprocess model |

Note: `~/work/feizh-share` (slides backup) was empty at analysis time. Analysis
proceeds with source code and documentation from the projects above.

---

## 2. Framework Deep-Dives

### 2.1 LangGraph — Graph Computation Runtime

**Core model**: Pregel BSP (Bulk Synchronous Parallel), borrowed from Google's
large-scale graph processing. Not a message-queue agent framework — it's a
deterministic graph computation engine that happens to run LLM agents as nodes.

**Key primitives**:

| Primitive | Purpose |
|-----------|---------|
| `StateGraph` | Defines nodes (functions) and edges (routing) over a shared state schema |
| `Channel` | Typed shared memory slots with conflict resolution (LastValue, Topic, BinaryOperatorAggregate) |
| `Reducer` | Merge function when multiple nodes write the same channel (e.g., `operator.add` for list append) |
| `Command` | Combined state update + routing instruction in a single return |
| `Send` | Dynamic fan-out: spawn parallel branches at runtime (map-reduce) |
| `Checkpoint` | Full state snapshot after each superstep — enables time-travel, replay, human-in-the-loop |

**Execution model**:
```
Superstep 0: START → determine active nodes
Superstep 1: Run all active nodes in parallel → collect writes → apply reducers → commit
Superstep 2: Evaluate conditional edges → determine next active nodes
... repeat until END node reached
```

Each superstep is a synchronization barrier. Nodes within one superstep run in
parallel but see a consistent snapshot of state from the previous superstep.

**5+1 Multi-Agent Patterns**:

| Pattern | Description | When to use |
|---------|-------------|-------------|
| **Network** | All agents can communicate with all others | Small teams, brainstorming |
| **Supervisor** | Central coordinator routes to workers | Most common; clear delegation |
| **Supervisor (tool-calling)** | Workers exposed as tools to supervisor LLM | Simplest implementation |
| **Hierarchical** | Multiple supervisor layers | Large agent teams, complex domains |
| **Custom workflow** | Hand-designed graph topology | Deterministic pipelines |
| **Swarm** (extension) | Agents self-select handoffs via tool calls | OpenAI Swarm-style emergent routing |

**Strengths**:
- Deterministic execution with full state reproducibility
- Channel+reducer model elegantly handles concurrent writes
- Checkpoint enables time-travel debugging, human-in-the-loop approval gates
- `Send` enables true dynamic parallelism (fan-out/fan-in)
- Stream modes (values, updates, messages, custom, debug) give fine-grained observability

**Weaknesses**:
- High conceptual overhead (Pregel model requires graph-thinking)
- State schema must be defined upfront — dynamic state evolution is awkward
- All agents must share the same state type (or use subgraphs to scope)
- Python-native; no TypeScript runtime (only client SDK)
- BSP synchronization barriers can serialize naturally-parallel work

**Key insight**: LangGraph's power comes from treating orchestration as a
computation graph problem. The tradeoff is rigidity — you get determinism and
reproducibility, but lose the flexibility of ad-hoc agent communication.

---

### 2.2 crewAI — Process + Flow Dual-Layer

**Core model**: Two distinct orchestration layers designed for different scales.

**Layer 1: Crew (task-level orchestration)**

```python
class Process(str, Enum):
    sequential = "sequential"
    hierarchical = "hierarchical"
    # consensual = "consensual"  # TODO: not yet implemented
```

- **Sequential**: Tasks execute in order, each agent's output feeds the next
- **Hierarchical**: A `manager_agent` (auto-created or user-supplied) receives all
  tasks and delegates to workers using `AgentTools` (delegation + question tools)

The hierarchical manager agent works by:
1. Receiving the full task list
2. Using `DelegateWorkTool` to assign tasks to specific agents
3. Using `AskQuestionTool` to query agents for information
4. Aggregating results

**Layer 2: Flow (workflow-level orchestration)**

Event-driven composition of multiple Crews or functions:

```python
@start()          # Entry point — triggers on flow.kickoff()
@listen(method)   # React to another method's completion
@router(method)   # Conditional branching based on return value
```

FlowState provides shared state across the flow, with `@start` methods running
first, `@listen` methods triggering reactively, and `@router` methods providing
conditional paths. This enables complex DAG-like workflows.

**Strengths**:
- Intuitive API — Process enum is immediately understandable
- Hierarchical delegation mirrors human team management
- Flow layer enables composition of multiple crews into pipelines
- Built-in crew-level memory and tool management

**Weaknesses**:
- Sequential is too rigid for complex tasks; hierarchical adds a full LLM call layer
- No built-in checkpointing or state persistence between runs
- Manager agent in hierarchical mode consumes significant tokens re-parsing context
- No dynamic parallelism (no equivalent of LangGraph's `Send`)
- `consensual` mode (agents negotiate who handles what) is still TODO

**Key insight**: crewAI's two-layer design (Crew for task execution, Flow for
workflow composition) is pragmatic but doesn't unify the models. The Flow layer
essentially reimplements a simpler version of what LangGraph does natively.

---

### 2.3 langgraph-supervisor — Thin Supervisor Layer

**Core model**: A convenience wrapper around LangGraph's StateGraph.

```python
def create_supervisor(
    agents: list[Runnable],
    model: BaseChatModel,
    *,
    tools: list[BaseTool] = [],
    prompt: str | ChatPromptTemplate | None = None,
    state_schema: type[AgentState] = AgentState,
    output_mode: Literal["full_history", "last_message"] = "full_history",
    ...
) -> StateGraph
```

Wraps each agent as a handoff tool. The supervisor LLM calls tools to delegate,
receiving results back in the message history.

**Key difference from crewAI hierarchical**: The supervisor uses LangGraph's
tool-calling mechanism rather than custom delegation tools. This means:
- Handoff is a standard tool call, not a special protocol
- The full message history is available to the supervisor
- State management is LangGraph's channel system, not crew-level state

**Assessment**: Useful as a reference for "supervisor-as-tool-caller" pattern but
not a standalone framework. The real orchestration logic is LangGraph underneath.

---

## 3. Pattern Comparison Matrix

### 3.1 Execution Model Comparison

| Dimension | LangGraph | crewAI | OpenTeam (current) |
|-----------|-----------|--------|-------------------|
| **Computation model** | BSP superstep graph | Sequential/hierarchical process | Lead dispatch + subprocess |
| **Parallelism** | Native (Send, parallel nodes) | None (sequential) or delegated (hierarchical) | Native (multiple Expert CLI processes) |
| **State model** | Typed channels + reducers | Crew-level shared state | Whiteboard (war-room) + Mailbox |
| **Routing** | Conditional edges, Command | Process type selection, @router | Lead dispatch decision tree |
| **Persistence** | Checkpoint (full state snapshot) | None built-in | SQLite (chats, execution_logs) + JSONL |
| **Communication** | Shared state (channels) | Agent delegation tools | Mailbox (point-to-point) + war-room (broadcast) |
| **Human-in-the-loop** | interrupt() + checkpoint resume | Input prompt | WebSocket user interaction |
| **Observability** | 7 stream modes | Verbose logging | SSE stream + terminal output |

### 3.2 Multi-Agent Coordination Patterns

| Pattern | LangGraph | crewAI | OpenTeam |
|---------|-----------|--------|----------|
| **Sequential pipeline** | Linear graph | Process.sequential | N/A (not supported) |
| **Supervisor delegation** | Supervisor pattern | Process.hierarchical | Lead → Expert dispatch |
| **Peer-to-peer** | Network pattern | DelegateWorkTool | Mailbox messages |
| **Dynamic fan-out** | Send() | Not supported | Multiple simultaneous expert starts |
| **Event-driven** | Command routing | Flow @listen/@router | Hook system (Pre/Post/Stop) |
| **Hierarchical management** | Multi-level supervisors | Manager agent | Lead only (single level) |

### 3.3 Scenario Fitness

| Scenario | Best pattern | LangGraph | crewAI | OpenTeam |
|----------|-------------|-----------|--------|----------|
| **Complex multi-step task** | Hierarchical supervisor + fan-out | Excellent | Good | Good (Lead dispatch) |
| **Simple single-agent task** | Direct execution (no orchestration) | Overkill | Overkill | Not optimized (still goes through Lead) |
| **Simple conversation** | Direct LLM call | Very overkill | Overkill | Not supported (always spawns CLI process) |
| **Iterative design review** | Human-in-the-loop loop | Good (interrupt) | Weak | Good (WebSocket interaction) |
| **Parallel independent tasks** | Fan-out + fan-in | Excellent (Send) | Not supported | Good (concurrent experts) |
| **Cross-agent handoff** | State passing / tool delegation | Good (Command) | Good (DelegateWork) | Good (Mailbox + war-room) |

---

## 4. Key Insights

### 4.1 The Three Execution Paradigms

Analysis reveals three fundamentally different execution paradigms:

1. **Graph computation** (LangGraph): Deterministic, reproducible, checkpoint-friendly.
   Best for structured workflows where the execution path can be defined as a graph.

2. **Process orchestration** (crewAI): Procedural, manager-delegated, intuitive.
   Best for task-list-style work where a human manager would assign tasks sequentially
   or delegate to specialists.

3. **Subprocess spawning** (OpenTeam): Independent, long-running, parallel.
   Best for autonomous expert work where each agent needs a full execution
   environment (file system, terminal, tools) and human review happens at delivery.

### 4.2 The Overhead Spectrum

```
Direct LLM call  →  Single agent  →  Supervisor  →  Graph orchestration
   ~0 overhead       ~5s startup      ~10s + LLM      ~20s + schema setup
```

No framework addresses the full spectrum well. Each is optimized for the middle
of the complexity curve, leaving simple tasks over-orchestrated and the most
complex tasks under-served.

### 4.3 The State Synchronization Problem

The central challenge in multi-agent orchestration is **how agents share state**:

- LangGraph: Explicit typed channels with reducers (formal, rigid, correct)
- crewAI: Task output passing (informal, flexible, lossy)
- OpenTeam: Whiteboard entries + mailbox messages (semi-structured, chat-scoped)

OpenTeam's whiteboard is closest to LangGraph's channel model — both are
shared-state-based rather than message-passing-based. But the whiteboard lacks
typed schemas and conflict resolution (reducers).

### 4.4 What OpenTeam Does Better

1. **Real execution environments**: Each Expert gets a full CLI process with file
   system access, terminal, and tool execution — not just LLM-as-function-call
2. **True parallelism**: Multiple Expert processes run simultaneously on actual
   compute, not simulated parallelism within a single event loop
3. **Human-compatible workflow**: Pulse-mode (dispatch → leave → review) aligns
   with how humans actually manage teams
4. **Agent identity and growth**: SOUL.md, IDENTITY.md, satisfaction scoring —
   agents have persistent identity and performance tracking

### 4.5 What OpenTeam Lacks

1. **No lightweight execution path**: Every task spawns a CLI subprocess, even
   "what's the project name?" — massive overhead for simple operations
2. **No structured workflow execution**: Cannot define "do A, then B, then if X
   do C else D" as a reusable graph or flow
3. **No checkpointing**: If a complex multi-agent task fails midway, there's no
   state snapshot to resume from (only JSONL transcript)
4. **Single-level hierarchy**: Lead dispatches Experts, but Experts cannot
   sub-dispatch to other Experts (peer-handoff exists but is different from
   hierarchical delegation)
5. **No fan-out/fan-in primitive**: Lead can start multiple experts, but there's
   no structured "wait for all, then aggregate" mechanism
