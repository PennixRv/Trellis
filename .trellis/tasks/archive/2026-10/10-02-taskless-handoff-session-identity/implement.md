# 执行

native start，pennix/v0.7-beta同步task.py模板与dogfood及回归；Marketplace现有main修正RecoveryBrief。统一CLI/core lint/typecheck/test。Marketplace先commit/push，CLI固定commit；release manifest/tag CI发布连续beta/core同版，核对npm后重装。根由native update消费，组件archive。

回退仅本任务差异，发布后修正版前推，保留runtime，不备份或加兼容资产。
