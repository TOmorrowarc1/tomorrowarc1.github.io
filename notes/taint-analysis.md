# Taint Analysis with SootUp and Jimple

## SootUp framework

**SootUp** is the modern, modular successor to the original Soot framework. It is designed as a suite of Java libraries providing a functional approach to static analysis. SootUp uses a **View** to define the scope for class and method lookups.

### 1. Core Architectural Components

1. **AnalysisInputLocation**: Defines the "Where." It points to the filesystem paths (JARs, directories, or modules) containing the code to be analyzed.
2. **View**: Defines the "Scope." It acts as the central repository. All lookups for classes and methods are performed through a View. It provides a consistent snapshot of the code.
3. **SootClass/Method/Field**: The structural models. They represent the metadata of the program.
4. **Body**: The implementation model. It contains the actual code of a method translated into an IR (Jimple).
5. **StmtGraph**: The Control-Flow Graph (CFG). It maps the execution paths between `Stmt` objects within a `Body`. (Statement is introduced in section about Jimple)

### 2. Basic usage demo

The following example uses SootUp 1.3.0 to load compiled classes from `target/classes`, look up `com.example.TargetClass.myMethod(int)`, and print its Jimple statements. The class and method must be present in that directory.

```java
import java.util.Collections;
import sootup.core.model.Body;
import sootup.core.signatures.MethodSignature;
import sootup.java.bytecode.inputlocation.JavaClassPathAnalysisInputLocation;
import sootup.java.core.JavaIdentifierFactory;
import sootup.java.core.views.JavaView;

public class SootUpDemo {
    public static void main(String[] args) {
        JavaView view = new JavaView(new JavaClassPathAnalysisInputLocation("target/classes"));
        JavaIdentifierFactory identifiers = view.getIdentifierFactory();
        MethodSignature signature = identifiers.getMethodSignature(
            "com.example.TargetClass", "myMethod", "void", Collections.singletonList("int")
        );
        Body body = view.getMethod(signature).orElseThrow().getBody();
        body.getStmts().forEach(System.out::println);
    }
}
```

## Jimple IR

In SootUp, Jimple is the intermediate representation bridging the gap between high-level Java source and low-level Bytecode. Though Jimple is represented by a suite of Java objects and contains Java-specific wrappers to provide the API for SootUp, its core is the **Control Flow** and **Data Flow** in `Body` of `SootMethod`.

By being **non-stack-based**, Jimple transforms implicit operand movements into explicit assignments between typed locals, making data dependencies transparent. Because of the usage of the **3-Address Code**, it decomposes complex, high-level expressions into atomic operations called `statements`.

### 1. The Statement Level: **Successor-Centric Control Flow**

In a pure execution environment (ignoring exceptions), a Jimple `Body` is a sequence of statements. Its control-flow graph describes how each statement reaches its normal successors. A fall-through statement proceeds to the next statement. A `goto` has one explicit target, an `if` has two possible successors, and a return terminates the path.

The following simplified Coq model represents the statement categories and their targets.

```coq
(* Formalized Parameters for Syntax Leafs *)
Parameter label : Type.
Parameter var   : Type.
Parameter value : Type.
Parameter expr  : Type.

(* Category 1: FallsThrough Statements (Exactly 1 successor: PC++)
   These statements represent linear, sequential execution flow. *)
Inductive fallsthrough_stmt : Type :=
  | JAssign       : var -> expr -> fallsthrough_stmt               (* x = expr *)
  | JIdentity     : var -> expr -> fallsthrough_stmt               (* x := @parameter / @this *)
  | JInvoke       : expr -> fallsthrough_stmt                      (* invoke f(x) *)
  | JEnterMonitor : var -> fallsthrough_stmt                       (* entermonitor x *)
  | JExitMonitor  : var -> fallsthrough_stmt                       (* exitmonitor x *)
  | JBreakpoint   : fallsthrough_stmt.                             (* breakpoint *)

(* Category 2: Branching Statements (one or more successors)
   These represent explicit redirections of the program counter. *)
Inductive branching_stmt : Type :=
  | JGoto         : label -> branching_stmt                        (* goto L *)
  | JIf           : expr -> label -> branching_stmt                (* if cond goto L *)
  | JSwitch       : expr -> list (value * label) -> label -> branching_stmt. (* switch/default *)

(* Category 3: Terminating Statements (Exactly 0 successors)
   These signify the end of a specific execution path. *)
Inductive terminating_stmt : Type :=
  | JReturn       : expr -> terminating_stmt                       (* return expr *)
  | JReturnVoid   : terminating_stmt.                              (* return *)

(* Unified Statement Representation *)
Inductive stmt : Type :=
  | S_FallThrough : fallsthrough_stmt -> stmt
  | S_Branching   : branching_stmt -> stmt
  | S_Terminating : terminating_stmt -> stmt.

(* A Labeled Statement: The atom of the Jimple Body *)
Record labeled_stmt : Type := mkLabeled {
  stmt_label : option label;
  stmt_body  : stmt
}.

(* A Jimple Body: A sequential representation of the program's logic *)
Definition jimple_body : Type := list labeled_stmt.
```

### 2. The Expression Level: Type-Decorated Data Flow

While the `StmtGraph` defines the topology of the program, **data flow** is governed by the values a statement reads and writes. Jimple represents expressions as values with types.

#### Values

Values represent the operands and expressions of three-address code.

- **Immediate**: The simplest form of data, including **Constants** (literals) and **Variables** (Locals).
- **Expressions**: Compound logic that performs a computation (e.g., `BinopExpr`, `InvokeExpr`). Due to the 3-address constraint, these are never nested; they act on immediate and produce a result.
- **References**: Locations in memory, such as **Field References** (`obj.field`) or **Array References** (`arr[i]`).

#### Types

Types in Jimple act as static labels on data, restricting the domain of values a variable can hold.

- **Primitive Type**: The fundamental primitives (e.g., `int`, `boolean`, `float`).
- **Reference Type**: Pointers to heap-allocated structures (Classes, Interfaces, Arrays).
- **Void Type**: A special singleton type used exclusively to denote the absence of a return value in method signatures and return statements.

## Taint Analysis

### 1. Concept

**Taint analysis** is an information-flow tracking method used to trace how specific data (the **source**) propagates through a system to reach an observation point (the **sink**).

A taint analysis is defined by three components, with optional sanitizers.

1. **Sources** are entry points where selected data is labeled.
2. **Propagation rules** define how labels move between values and memory locations.
3. **Sinks** are observation points where the analysis checks for a label.
4. **Sanitizers** are operations modeled as removing a label for the property being checked.

### 2. Propagation logic

The analysis maintains a **Taint Set** $\Sigma$ containing all locations (variables/references) currently considered tainted.

1. Initialize $\Sigma$ with the designated Source.
2. Apply a transfer function to each statement. An assignment propagates labels from its right-hand side and replaces the destination’s previous labels.
3. Where paths join, a forward **may** analysis takes the union of the sets from all incoming edges.

> In static analysis, this requires a **Fixed-Point Iteration** over the Control Flow Graph to ensure that loops are processed until the Taint Set stabilizes.

### 3. Static vs. Dynamic Analysis

| Feature | **Static taint analysis** | **Dynamic taint analysis** |
| --- | --- | --- |
| **Execution** | Analyzes possible flows from program code and models. | Tracks labels during a concrete execution. |
| **Scope** | Can consider paths beyond the workloads that have run. | Observes paths exercised by the chosen workloads. |
| **Limitations** | Conservative approximations can report infeasible flows. Coverage depends on the call graph and models. | Can miss unexecuted flows. Results also depend on the instrumentation and propagation rules. |

### 4. Tainting Rules for Jimple

To implement taint analysis on a specific IR, it is necessary to formalize the **Transfer Functions** $\mathcal{F}$ on the Jimple statement types previously defined. Set $\Gamma$ as the set of tainted locals at a program point.

**Rule 1: Identity (Source Entry)**

When a parameter designated as a source is bound to a local, add that local to the taint set.

$$\frac{x := \text{parameter}_n \quad n \text{ is a designated source}}{\Gamma' = \Gamma \cup \{x\}}$$

**Rule 2: Assignment (Propagation)**

If any variable in expression $e$ is tainted, the destination $x$ becomes tainted. Otherwise, the assignment clears the old taint on $x$.

$$
\Gamma' =
\begin{cases}
\Gamma \cup \{x\} & \text{if } \text{vars}(e) \cap \Gamma \ne \varnothing, \\
\Gamma \setminus \{x\} & \text{otherwise.}
\end{cases}
$$

### 5. Worked example

The following simplified Jimple body tracks a configured timeout through an assignment and into a call.

```text
configuredTimeout := @parameter0: int;
retryBudget = configuredTimeout + 100;
staticinvoke <com.example.TargetClass: void recordBudget(int)>(retryBudget);
return;
```

Mark the first parameter as the source and the argument to `recordBudget` as the sink. The assignment makes `retryBudget` depend on `configuredTimeout`, so the analysis reports that the label reaches the call. The report identifies a dependency. A separate check would establish whether the resulting timeout is valid.

The transfer rules above track explicit value flow. A conditional can also influence which value is assigned through a control dependency. Tracking a value inside the callee requires mapping the argument at the call site to its formal parameter. Field and array accesses also require a model of heap locations and aliasing.
