import { Entity, Column, PrimaryColumn, Index, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('documents')
export class Document {
  @PrimaryColumn({
    name: 'document_id',
    transformer: { from: value => value, to: value => value },
  })
  documentId: string;

  @PrimaryColumn({
    name: 'index_name',
    transformer: { from: value => value, to: value => value },
  })
  indexName: string;

  @Column('jsonb')
  content: Record<string, any>;

  @Column('jsonb', { default: '{}' })
  metadata: Record<string, any>;

  @Column('tsvector', { name: 'search_vector' })
  searchVector: any;

  @Column('tsvector', { name: 'materialized_vector', nullable: true })
  materializedVector: any;

  @Column('jsonb', { name: 'field_weights', default: '{}' })
  fieldWeights: Record<string, number>;

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
