
import type BetterSqlite3 from 'better-sqlite3'
import { migrateToV2 } from './v2'
import { migrateToV3 } from './v3'
import { migrateToV4 } from './v4'
import { migrateToV5 } from './v5'
import { migrateToV6 } from './v6'
import { migrateToV7 } from './v7'
import { migrateToV8 } from './v8'
import { migrateToV9 } from './v9'
import { migrateToV10 } from './v10'
import { migrateToV11 } from './v11'
import { migrateToV12 } from './v12'
import { migrateToV13 } from './v13'
import { migrateToV14 } from './v14'
import { migrateToV15 } from './v15'
import { migrateToV16 } from './v16'
import { migrateToV17 } from './v17'
import { migrateToV18 } from './v18'
import { migrateToV19 } from './v19'
import { migrateToV20 } from './v20'
import { migrateToV21 } from './v21'
import { migrateToV22 } from './v22'
import { migrateToV23 } from './v23'
import { migrateFromJson } from './json-migration'

export function runMigrations(db: BetterSqlite3.Database): void {
  migrateToV2(db)
  migrateToV3(db)
  migrateToV4(db)
  migrateToV5(db)
  migrateToV6(db)
  migrateToV7(db)
  migrateToV8(db)
  migrateToV9(db)
  migrateToV10(db)
  migrateToV11(db)
  migrateToV12(db)
  migrateToV13(db)
  migrateToV14(db)
  migrateToV15(db)
  migrateToV16(db)
  migrateToV17(db)
  migrateToV18(db)
  migrateToV19(db)
  migrateToV20(db)
  migrateToV21(db)
  migrateToV22(db)
  migrateToV23(db)
  migrateFromJson(db)
}
