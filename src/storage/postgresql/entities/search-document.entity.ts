import { Entity, Column, PrimaryColumn, Index, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('search_documents')
export class SearchDocument {
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

  @Column('tsvector', { name: 'search_vector' })
  searchVector: any;

  @Column('jsonb', { name: 'field_weights' })
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
