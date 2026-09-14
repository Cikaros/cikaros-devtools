# .github/workflows/agent-evals.yml — 持续评估套件 CI 配置模板
#
# Anthropic playbook：评估是 AI 原生的阶段门 QA 等价物。
# 当代理的配置（AGENTS.md / skills / hooks）发生变化时，评估套件说明代理是否仍按相同标准执行。
#
# 安装：复制到 .github/workflows/agent-evals.yml，按需调整 paths 与 schedule。

name: Agent evals

on:
  pull_request:
    paths:
      - 'AGENTS.md'
      - '.codex/**'
      - '.sdlc/**'
      - 'skills/**'
  schedule:
    - cron: '0 2 * * *'  # 每天凌晨 2 点

jobs:
  evals:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Codex CLI
        run: npm install -g @openai/codex

      - name: Run eval suite
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: |
          total_pass=0
          total_fail=0
          for eval in evals/*.json; do
            echo "=== Running eval: $eval ==="
            prompt=$(jq -r '.prompt' "$eval")
            codex exec "$prompt" \
              --sandbox workspace \
              --output-last-message result.json 2>&1 || true

            if ./evals/check.sh "$eval" result.json; then
              echo "PASS: $eval"
              total_pass=$((total_pass + 1))
            else
              echo "FAIL: $eval"
              total_fail=$((total_fail + 1))
            fi
          done

          echo "=== Eval summary ==="
          echo "Pass: $total_pass"
          echo "Fail: $total_fail"

          # 门控：通过率低于 80% 时失败
          total=$((total_pass + total_fail))
          if [ "$total" -gt 0 ]; then
            pass_rate=$((total_pass * 100 / total))
            if [ "$pass_rate" -lt 80 ]; then
              echo "Eval pass rate $pass_rate% below 80% threshold"
              exit 1
            fi
          fi

      - name: Upload eval results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: eval-results
          path: |
            result.json
            evals/
