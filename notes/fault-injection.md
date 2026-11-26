# Fault Injection

## 1. The Concept of Fault Injection

### 1.1 Targets and Theoretical Design

The primary objective of fault injection is to validate two critical metrics: **fault coverage** and **resilience**. Fault coverage measures the percentage of potential failure scenarios the system is equipped to handle, while resilience refers to a system’s ability to maintain service continuity under these uncurrent circumstances.

The basic design for fault injection is **throwing exceptions into specific paths of the source code**, while it can also be designed in such a way based on states to prune the test space and simplify the implementation.

From a theoretical perspective, we can model a program/(cloud) system as a **Turing Machine**. In this analogy:

- The **tape** represents the system's I/O and memory.
- The **rules** (transition function $\delta$) represent the source code logic.
- The **context** represents the machine's internal states.

Under this model, **fault injection** is the deliberate corruption of the transition function or the mutation of the tape contents while the machine is in operation. The goal is to verify that even when the machine is forced into an **error state**, the internal logic is robust enough to prevent that error from **propagating** into a catastrophic **system failure**. Ideally, the system should contain the error internally, ensuring it does not "escape" to affect the end-user.

### 1.2 Implementation

Implementation is broadly categorized into two phases based on when the fault is introduced: **compile-time** and **runtime** injection.

- **Compile-time (Static) Injection:** This method involves mutating the source code or the compiled binary before execution. For example, changing `a = a - 1` to `a = a + 1` or adding `a = a + 1` into the source code.
- **Runtime (Dynamic) Injection:** This occurs while the system is actively processing workloads.
    - **Logic Interception:** This involves using system calls or debuggers to intercept the execution flow, allowing the tester to block, kill, or restart specific processes.
    - **Environmental Perturbation:** In the context of cloud systems, testers may attack the environment by manipulating the infrastructure. Examples include using `tc` to simulate network latency, exhausting CPU/RAM resources, or terminating Docker containers to simulate hardware failure.

### 1.3 Critical Implementation Challenges

Designing an effective fault injection experiment requires answering following fundamental questions:

1. **Type of Faults:** *What* specific error should be tested? (e.g., a bit-flip, a network partition, or a disk timeout).
2. **Time and Location:** *Where* should the fault be placed? Identifying the most vulnerable code paths or critical components is essential. *When* should the fault be activated? The timing depends on the behavior being tested. For example, testing recovery under load requires injecting the fault while requests are in flight.
3. **Oracles:** *How* to check whether the system successfully resists faults injected?
- Problem: State-Space Explosion

    The most significant challenge facing fault injection is the **combinatorial explosion of the test space**. In a modern cloud architecture consisting of hundreds of microservices, the number of possible fault combinations— with different **types of faults**, across different **components**, at different **timestamps**, under different workloads—is nearly infinite. Consequently, researchers must prioritize "high-value" faults and use intelligent orchestration to ensure the testing remains both feasible and effective.
