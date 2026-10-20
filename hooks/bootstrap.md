The superpowers skills are installed. They describe a working method for software changes: shape the request into a spec, plan it as small verifiable tasks, build test-first, verify with evidence, review by risk, and finish cleanly. Each skill's description says when it applies; the `using-superpowers` skill is the index.

Size the request before choosing a path. A one-line fix or a question needs no ceremony. A small, clear change uses a quick task. Anything with several parts, unclear requirements, or design choices goes through shaping and planning first. User instructions always take precedence over the skills.

Progress and evidence are kept by the `sp` command, which records test runs, reviews and task state in `.superpowers/` so they survive context compaction. In this session run it as: {{SP}} <command> (for example `{{SP}} status`). The skills write it as `sp` for short.
