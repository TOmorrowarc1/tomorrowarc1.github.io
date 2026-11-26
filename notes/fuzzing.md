# Fuzzing

## Fuzzing as a Search Problem

Conceptually, fuzzing can be abstracted as a guided search over a high-dimensional vector space representing all possible program inputs.

Let the program under test be represented by $P$, and the input space by $\mathcal{X}$. This input space can be structured (e.g., conforming to a JSON/AST grammar) or unstructured (represented physically as the infinite discrete space of arbitrary byte sequences, $\Sigma^*$).

$$
P: \mathcal{X} \to \mathcal{S}
$$

where $\mathcal{S}$ is the set of all reachable program execution states or traces.

To evaluate whether an execution violates a security, semantic, or functional policy, we define a binary **Bug Oracle** $\Omega$:

$$
\Omega: \mathcal{S} \to \{0, 1\}
$$

- $\Omega(s) = 0$ indicates normal program execution.
- $\Omega(s) = 1$ indicates a policy violation (such as a crash, memory corruption, or assertion failure).

The fundamental objective of fuzzing is to locate the subset of inputs $\mathcal{X}_{bug} \subseteq \mathcal{X}$ that violate the oracle:

$$
\text{Find } x \in \mathcal{X} \quad \text{such that} \quad \Omega(P(x)) = 1
$$

Because the cardinality of the input space $|\mathcal{X}|$ is astronomically large (or infinite) and the computational budget $T$ is strictly limited, exhaustive evaluation of $\mathcal{X}$ is impossible. Therefore, fuzzing on systems must be approached as a **heuristic search problem**.

## Navigating the Space: Fuzzing Heuristics

To find the sparse subset of inputs $\mathcal{X}_{bug}$ within the vast space $\mathcal{X}$, fuzzing engines rely on several key heuristics to guide their search.

### Heuristic A: Seeds as Search Anchors (The Topology of Code Faults)

Instead of sampling uniformly at random across the vast, unstructured input space $\mathcal{X}$, mutational engines anchor their search around a pool of high-quality **seeds** ($T \subset \mathcal{X}$). They can be inputs constructed by the developers from the tests or the ones generated in the progress but have good characteristics and the engine generate the inputs by slightly mutating them. This strategy is mathematically and conceptually justified by two foundational software engineering principles:

#### 1. The Competent Programmer Hypothesis

The *Competent Programmer Hypothesis* states that programmers write programs that are *almost correct*. Rather than introducing entirely random, "alien" logic, developer errors are typically minor syntactic or semantic faults—such as off-by-one errors, missing bounds checks, or integer overflow oversights.

- **Control-Flow Adjacency:** Because the program code is almost correct, the buggy execution path $\pi_{\text{bug}}$ is topologically adjacent to the expected valid path $\pi_{\text{valid}}$ in the Control Flow Graph (CFG). They share nearly all of their executed edges.
- **Boundary Exploration:** To reach the logical edge where a bug resides, the engine must first execute the valid path. Starting with a valid seed ensures the engine reaches this exact semantic boundary, bypassing the "parser roadblocks" (like magic bytes, checksums, or schema validations) that immediately reject random inputs.

#### 2. The Semantic Locality Assumption

Mutational fuzzing relies on the assumption of **Semantic Locality**—that a small, localized mutation in the physical input space $\mathcal{X}$ maps to a small, controlled transition in the program’s execution state space $\mathcal{S}$.

- **Block-Based Processing:** Modern software parsers process files modularly (e.g., token-by-token or field-by-field). Changing a single parameter (such as a port number or string value) typically only alters the semantic path evaluating that specific field, leaving the rest of the execution flow stable.
- **Weak Continuity:** While software execution is fundamentally discrete and non-continuous ,the fuzzing assumes *weak continuity*. If a physical mutation completely scrambled execution behavior in every instance, mutational fuzzing would degrade into blind random search. Assuming weak continuity allows the engine’s genetic feedback loop to incrementally climb the path-coverage gradient, discovering new paths that are structurally and semantically related to the parent seed.

### Heuristic B: Execution-Guided Feedback

To explore new paths, engines can instrument the binary at compile-time to collect lightweight **runtime execution feedback**.

- **Edge Coverage:** Transition points (branches) are assigned unique IDs. When an input is executed, the program records branch transitions in a shared memory bitmap.
- **Evolutionary Selection:** If a mutated input executes a previously unseen edge (or triggers a significant change in branch execution counts), it is deemed "interesting" and added back into the seed pool to serve as a parent for future mutations.
- **Deduplication:** To prevent disk and triage bloat, a crashing input is only saved as a "unique crash" if it triggered the crash via a previously unrecorded execution path.

### Heuristic C: Distance-Based Target Seeking

When the testing objective is targeted such as a specific basic  block, the engines can attempt to minimize the distance between the executed path and the target program locations ($T_b$).

- **Distance Calculation:** During compilation, the engine extracts the Call Graph (CG) and intra-procedural Control Flow Graphs (CFGs).
- **The Metric:** The distance $d_f(n, T_f)$ from a function $n$ to a set of target functions $T_f$ is defined as the harmonic mean of the shortest paths: This is combined with basic-block-level distances within individual CFGs to yield a normalized seed distance $\tilde{d}(s)$ between $0$ and $1$.

    $$
    d_f(n, T_f) = \left( \sum_{t_f \in T_f} d_f(n, t_f)^{-1} \right)^{-1}
    $$

- **The Optimization:** The engine converts directed fuzzing into a continuous minimization problem, spending more mutation energy on seeds that yield a smaller distance $\tilde{d}(s)$ to the target.

### Heuristic D: Program Analysis

Dynamic Symbolic Execution uses heavy program analysis to guide input generation.

- **The Constraint Solver as a Mutator:** Instead of guessing random mutations, DSE tracks the symbolic path formula $\phi$ of a concrete execution run. It then systematically negates branch conditions (e.g., changing $\phi = a \land b$ to $\phi' = a \land \neg b$) and queries an SMT solver (like Z3) to mathematically calculate the exact input required to traverse the new path.

## Trade-off: Throughput vs. Precision

The information get from no matter the static analysis or the runtime feedback can increase the accuracy of the state exploration, however, the analysis itself can have a heavy cost. Consequently, the engine must spend the budget on input testing and input generation wisely under specific circumstances. This trade-off determines the "box classification" of the engines based on the amount of program semantics analyzed:

- **Black-Box Fuzzing (High Throughput, Low Precision):** Uses zero program execution feedback. It runs exceptionally fast (allowing millions of executions) but cannot intelligently navigate deep, complex code branches.
- **Grey-Box Fuzzing (Balance):** Uses lightweight instrumentation (edge coverage/distance) to guide mutations. It maintains high execution speeds (thousands of runs per second) while gaining partial feedback to systematically map out program paths.
- **White-Box Fuzzing (Low Throughput, High Precision):** Uses full control-flow and data-flow symbolic analysis usually contains the SMT solver. It takes a long time to generate a single input.

## Trade-off: Exploration vs. Exploitation

Once the engine has collected a pool of seeds, it must decide how to distribute its finite **mutation budget** through setting the number of test inputs generated per seed.

#### 1. Exploration

- **The Strategy:** The engine spends its mutation budget lightly across **as many different seeds as possible**. It performs a few mutations on Seed A, quickly moves to Seed B, then to Seed C, and so on.
- **The Goal (Broad Discovery):** By testing many structurally diverse seeds, the engine maximizes its chances of discovering new, unexplored components of the program.
- **The Risk:** If the engine moves too quickly between seeds, it may not mutate any single seed deeply enough to bypass tight, nested branch checks to trigger complex corruptions.

#### 2. Exploitation

- **The Strategy:** The engine selects a single promising seed and **concentrates a massive portion of its mutation budget on it**. It stays on Seed A and generates thousands or millions of mutations from this single parent before moving on.
- **The Goal (Deep Triggering):** To trigger a crash hide deep inside a specific code component. By exhaustively "pounding" the neighborhood of a single seed, the engine increases the probability of hitting the exact edge-case values required to violate the bug oracle.
- **The Risk:** If the engine spends too much of its budget mutating a single seed, it "gets stuck". It wastes millions of execution cycles repeatedly exercising the same narrow code path, failing to discover other modules of the program where easier bugs might be hiding.

In real world design, the strategy is dynamically switching and the budget are scheduling on seeds wisely.

## Hybrid Grey-White Box Fuzzing

**Concolic Execution (Symbolic Execution)**: Capable of systematically navigating complex conditions to reach specific code paths. However, it suffers from severe **path explosion**, making it computationally expensive and limiting its scalability to analyze deeper code in complex binaries.

Fuzzing engines get stuck on "specific checks" (e.g., magic numbers or complex data structure validations) that require exact input values, effectively limiting their exploration to "shallow" program paths.

Driller's key insight is to combine fuzzing and concolic execution in a **complementary and cooperative manner** to leverage their individual strengths while mitigating their weaknesses: Grey-box fuzzing contributes breadth. It explores many paths cheaply and supplies concrete executions that give concolic analysis a place to start. Concolic execution contributes precision where mutation stalls. Using it selectively concentrates solver effort on a small part of the search.

Driller invokes the **concolic execution engine** to "drill" through this bottleneck. The concolic engine calculates new, precise inputs that satisfy these complex checks. These new inputs are then fed back into the engine’s queue, allowing it to continue its high-speed exploration into previously unreachable "compartments" of the application.

> Frankly speaking, the assumption is not hold at all circumstances, for example, maybe the hard gates is more than one so even passing one of them can not dive further.

> Also, fuzzing is much more easy to implement on complex systems than symbolic execution because of the enviroment modeling problem so there is a target system adaptation cost compared to pure grey/black fuzzing.

> Anyway, it is still a good(maybe the most direct) choice when facing hard gates on the target path in fuzzing.
