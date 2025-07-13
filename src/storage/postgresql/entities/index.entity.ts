import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('indices')
export class Index {
  @PrimaryColumn({
    name: 'index_name',
    transformer: { from: value => value, to: value => value },
  })
  indexName: string;

  @Column('jsonb')
  settings: {
    fieldWeights: Record<string, number>;
    defaultLanguage: string;
    stopWords: string[];
  };

  @CreateDateColumn({
    name: 'created_at',
    transformer: { from: value => value, to: value => value },
  })
  createdAt: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    transformer: { from: value => value, to: value => value },
  })
  updatedAt: Date;
}
